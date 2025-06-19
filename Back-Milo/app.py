# -*- coding: utf-8 -*-
from flask import Flask, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import json
import base64
import os
import logging
import threading
import time

from collections import deque, defaultdict
from openai import AzureOpenAI
from dotenv import load_dotenv
import re

from elevenlabs.client import ElevenLabs
# from elevenlabs import stream # Not needed

from system_prompt import prompt

# --- Logging, Env Vars, Flask App, CORS Setup (Same as before) ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
load_dotenv(override=True)
app = Flask(__name__)
#ORS_ORIGINS = os.getenv('CORS_ORIGINS', 'http://localhost:3001,http://127.0.0.1:3001,https://aid-front.baaaack.com,http://localhost:3000,http://localhost:8080').split(',')
CORS_ORIGINS = os.getenv('CORS_ORIGINS', 'http://localhost:8080').split(',')
CORS(app,
     resources={r"/*": {"origins": CORS_ORIGINS}},
     supports_credentials=True)

# --- Rate Limiting (Same as before) ---
RATE_LIMIT = 5
RATE_WINDOW = 60
ip_rate_limits = defaultdict(list)

# --- Routes (Same as before) ---
@app.route('/')
def index(): return "Backend server is running. Status: OK"
@app.route('/health')
def health_check(): return {"status": "healthy", "timestamp": time.time(), "version": "1.0.3"} # Incremented

# --- Socket.IO Setup (Same as before) ---
socketio = SocketIO(
    app,
    cors_allowed_origins=CORS_ORIGINS,
    async_mode='threading',
    ping_timeout=60,
    ping_interval=25,
  # transports=['websocket'],
    max_http_buffer_size=50 * 1024 * 1024,
    logger=True,
    engineio_logger=True
)

# --- OpenAI Client (Same as before) ---
AZURE_OPENAI_DEPLOYMENT_NAME = os.getenv('AZURE_OPENAI_DEPLOYMENT_NAME')
openai_client = AzureOpenAI(
    azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
    timeout=60.0,
    max_retries=3
)

# --- ElevenLabs Configuration & Client Initialization (Same as before) ---
ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY')
ELEVENLABS_VOICE_ID = os.getenv('ELEVENLABS_VOICE_ID')
ELEVENLABS_MODEL_ID = os.getenv('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2')
ELEVENLABS_OUTPUT_FORMAT = os.getenv('ELEVENLABS_OUTPUT_FORMAT', 'mp3_44100_128')
if not ELEVENLABS_API_KEY or not ELEVENLABS_VOICE_ID:
    logger.error("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set.")
    exit(1)
try:
    eleven_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
    logger.info("ElevenLabs SDK client initialized.")
except Exception as e:
    logger.error(f"Failed to initialize ElevenLabs client: {e}", exc_info=True)
    eleven_client = None

# --- Active Sessions & Rate Limiting Check (Same as before) ---
active_sessions = {}
def is_rate_limited(ip_address):
    current_time = time.time()
    timestamps = ip_rate_limits[ip_address]
    while timestamps and timestamps[0] <= current_time - RATE_WINDOW:
        timestamps.pop(0)
    if len(timestamps) >= RATE_LIMIT: return True
    timestamps.append(current_time)
    return False

# --- Socket.IO Event Handlers (connect, disconnect - Same as before) ---
@socketio.on('connect')
def handle_connect():
    client_id = request.sid
    logger.info(f"Client connected: {client_id}")
    ip_address = request.remote_addr
    if request.headers.get('X-Forwarded-For'):
        ip_address = request.headers.get('X-Forwarded-For').split(',')[0].strip()
    active_sessions[client_id] = {
        'connected_at': time.time(), 'last_activity': time.time(),
        'processing': False, 'message_count': 0,
        'ip_address': ip_address, 'disconnected': False
    }
    emit('connected', {'message': 'Connected to server', 'session_id': client_id})

@socketio.on('disconnect')
def handle_disconnect(*args, **kwargs):
    client_id = request.sid
    logger.info(f"Client disconnected: {client_id}")
    if client_id in active_sessions:
        active_sessions[client_id]['disconnected'] = True

# Modified query event handler to check for Discussion Mode
@socketio.on('query')
def handle_query(data):
    client_id = request.sid
    messages = data.get('messages', [])
    is_discussion_mode = bool(data.get('isDiscussionMode', False))
    
    if client_id not in active_sessions:
        logger.warning(f"Query from unknown client: {client_id}")
        emit('error', {'message': 'Session not found.'}, to=client_id)
        return
    session_data = active_sessions[client_id]
    ip_address = session_data['ip_address']
    if is_rate_limited(ip_address): # Check rate limit
        logger.warning(f"Rate limit exceeded: IP {ip_address}, Client {client_id}")
        emit('error', {'message': 'Rate limit exceeded.', 'code': 'RATE_LIMITED'}, to=client_id)
        return
    if not messages or not isinstance(messages, list): # Check message format
        emit('error', {'message': 'Invalid message format'}, to=client_id)
        return
    if session_data.get('processing', False): # Check if already processing
        logger.warning(f"Client {client_id} sent query while busy.")
        emit('error', {'message': 'Already processing.'}, to=client_id)
        return

    # Store Discussion Mode in session data
    session_data.update({
        'last_activity': time.time(), 
        'message_count': session_data['message_count'] + 1, 
        'processing': True, 
        'disconnected': False,
        'is_discussion_mode': is_discussion_mode
    })
    
    logger.info(f"Starting processing for client {client_id} (Discussion Mode: {is_discussion_mode})")
    socketio.start_background_task(
        process_query_and_stream_elevenlabs_sdk_batched_text,
        messages=messages,
        client_id=client_id
    )

# Modified main processing function with strict Discussion Mode enforcement
def process_query_and_stream_elevenlabs_sdk_batched_text(messages, client_id):
    """
    Handles LLM query, accumulates full text, then streams audio using SDK only if Discussion Mode is enabled.
    Implements audio buffering for smoother playback.
    """
    is_llm_complete = False
    llm_error = None
    tts_error = None
    session_data = active_sessions.get(client_id)

    if not session_data:
        logger.error(f"process_query called for non-existent client ID: {client_id}")
        return
        
    is_discussion_mode = bool(session_data.get('is_discussion_mode', False))
    logger.info(f"[Client {client_id}] Discussion Mode is {'enabled' if is_discussion_mode else 'disabled'}")
    
    if is_discussion_mode and not eleven_client:
        logger.error(f"[Client {client_id}] Cannot process TTS query, ElevenLabs client missing.")
        if not session_data.get('disconnected'):
            socketio.emit('error', {'message': 'TTS service unavailable.'}, to=client_id)
        if client_id in active_sessions: active_sessions[client_id]['processing'] = False
        return

    full_response_text = ""

    try:
        # --- 1. LLM Streaming and Text Accumulation ---
        logger.info(f"[Client {client_id}] Starting LLM stream...")
        messages.insert(0, {'role': 'system', 'content': prompt})
        completion = openai_client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT_NAME, messages=messages, stream=True, temperature=0.7, max_tokens=800,
        )

        for response in completion:
            session_data = active_sessions.get(client_id) # Check disconnect
            if not session_data or session_data.get('disconnected'):
                logger.warning(f"[Client {client_id}] Disconnected during LLM stream.")
                llm_error = "Client disconnected"
                break

            if response.choices and response.choices[0].delta and response.choices[0].delta.content:
                llm_chunk = response.choices[0].delta.content
                processed_chunk = llm_chunk.replace("l'ECE", "l'E C E").replace("ECE", "E C E")
                processed_chunk = llm_chunk.replace("ING", "ingé")
                if processed_chunk:
                    socketio.emit('text_chunk', {'text': processed_chunk}, to=client_id)
                    full_response_text += processed_chunk

        if not llm_error:
             logger.info(f"[Client {client_id}] LLM stream finished.")
             is_llm_complete = True

        # --- 2. TTS Generation and Audio Streaming with Buffering (ONLY if Discussion Mode is enabled) ---
        session_data = active_sessions.get(client_id) # Re-check state
        
        # Re-check Discussion Mode setting (in case it changed during LLM streaming)
        if session_data:
            is_discussion_mode = bool(session_data.get('is_discussion_mode', False))
        
        # STRICT CHECK: Only proceed with TTS if explicitly enabled
        if is_llm_complete and is_discussion_mode and full_response_text.strip() and session_data and not session_data.get('disconnected'):
            logger.info(f"[Client {client_id}] Starting TTS generation for accumulated text...")
            try:
                # Higher quality audio format
                output_format = ELEVENLABS_OUTPUT_FORMAT
                
                # Add optimization options for speech synthesis
                audio_stream = eleven_client.text_to_speech.convert_as_stream(
                    text=full_response_text.strip(),
                    voice_id=ELEVENLABS_VOICE_ID,
                    model_id=ELEVENLABS_MODEL_ID,
                    output_format=output_format,
                )

                audio_sent = False
                logger.info(f"[Client {client_id}] Streaming audio back to client...")
                
                # --- Implement buffering for smoother playback ---
                buffer_size = 64 * 1024  # 64 KB buffer size
                audio_buffer = b""
                
                for audio_chunk in audio_stream:
                    # Double-check Discussion Mode is still enabled
                    current_session = active_sessions.get(client_id)
                    if current_session:
                        current_discussion_mode = bool(current_session.get('is_discussion_mode', False))
                        # Stop streaming if Discussion Mode was turned off
                        if not current_discussion_mode:
                            logger.info(f"[Client {client_id}] Discussion Mode disabled during streaming, stopping audio")
                            break
                    
                    # Check disconnect during audio stream
                    if not current_session or current_session.get('disconnected'):
                        logger.warning(f"[Client {client_id}] Disconnected during TTS audio emission.")
                        tts_error = "Client disconnected during audio stream"
                        break

                    if isinstance(audio_chunk, bytes) and audio_chunk:
                        # Add to buffer instead of sending immediately
                        audio_buffer += audio_chunk
                        
                        # Only send when buffer reaches threshold size
                        if len(audio_buffer) >= buffer_size:
                            socketio.emit(
                                'audio_chunk',
                                {
                                    'audio': base64.b64encode(audio_buffer).decode('utf-8'),
                                    'format': output_format.split('_')[0]
                                },
                                to=client_id
                            )
                            audio_sent = True
                            audio_buffer = b""  # Reset buffer
                
                # Send any remaining buffered audio
                if audio_buffer and not tts_error:
                    socketio.emit(
                        'audio_chunk',
                        {
                            'audio': base64.b64encode(audio_buffer).decode('utf-8'),
                            'format': output_format.split('_')[0]
                        },
                        to=client_id
                    )
                    audio_sent = True

                if audio_sent and not tts_error:
                    logger.info(f"[Client {client_id}] Finished streaming audio via SDK.")
                elif not audio_sent and not tts_error:
                    logger.warning(f"[Client {client_id}] No audio data received/sent from TTS SDK.")

            except Exception as e:
                tts_error = str(e)
                logger.error(f"[Client {client_id}] Error during TTS streaming: {e}", exc_info=True)
        else:
            # Log the specific reason TTS was skipped
            if not is_discussion_mode:
                logger.info(f"[Client {client_id}] Discussion Mode is disabled, skipping audio generation.")
            elif not is_llm_complete:
                logger.warning(f"[Client {client_id}] Skipping TTS due to incomplete LLM response.")
            elif not full_response_text.strip():
                logger.warning(f"[Client {client_id}] Skipping TTS (empty LLM response).")
            elif not session_data or session_data.get('disconnected'):
                logger.warning(f"[Client {client_id}] Skipping TTS (client disconnected before TTS start).")

    except Exception as e: # Catch errors during LLM phase
        llm_error = str(e)
        logger.error(f"[Client {client_id}] Error during LLM processing: {llm_error}", exc_info=True)

    finally:
        # --- Complete the request ---
        logger.info(f"[Client {client_id}] Processing complete. LLM complete={is_llm_complete}, LLM Error={llm_error}, TTS Error={tts_error}")
        session_data = active_sessions.get(client_id)
        final_error = llm_error or tts_error
        should_send_complete = is_llm_complete and not final_error

        if session_data and not session_data.get('disconnected'):
            if should_send_complete:
                logger.info(f"[Client {client_id}] Emitting 'complete' signal.")
                socketio.emit('complete', {}, to=client_id)
            elif final_error:
                logger.error(f"[Client {client_id}] Emitting final error: {final_error}")
                socketio.emit('error', {'message': f'Processing failed: {final_error}'}, to=client_id)

        if client_id in active_sessions:
            active_sessions[client_id]['processing'] = False
            active_sessions[client_id]['last_activity'] = time.time()
            if active_sessions[client_id].get('disconnected'):
                logger.info(f"Removing disconnected session {client_id} after processing.")
                try: del active_sessions[client_id]
                except KeyError: pass
            else:
                logger.info(f"Finished processing for client {client_id}. Session active.")
        else:
             logger.warning(f"Session {client_id} already removed before final cleanup.")
             
# --- Updated Main Processing Function ---
#ef process_query_and_stream_elevenlabs_sdk_batched_text(messages, client_id):
#   """
#   Handles LLM query, accumulates full text, then streams audio using SDK.
#   Implements audio buffering for smoother playback.
#   """
#   is_llm_complete = False
#   llm_error = None
#   tts_error = None
#   session_data = active_sessions.get(client_id)
#
#   if not session_data:
#       logger.error(f"process_query (batch v2) called for non-existent client ID: {client_id}")
#       return
#   if not eleven_client:
#       logger.error(f"[Client {client_id}] Cannot process query, ElevenLabs client missing.")
#       if not session_data.get('disconnected'):
#           socketio.emit('error', {'message': 'TTS service unavailable.'}, to=client_id)
#       if client_id in active_sessions: active_sessions[client_id]['processing'] = False
#       return
#
#   full_response_text = ""
#
#   try:
#       # --- 1. LLM Streaming and Text Accumulation ---
#       logger.info(f"[Client {client_id}] Starting LLM stream...")
#       messages.insert(0, {'role': 'system', 'content': prompt})
#       completion = openai_client.chat.completions.create(
#           model="gpt-4.1", messages=messages, stream=True, temperature=0.7, max_tokens=800,
#       )
#
#       for response in completion:
#           session_data = active_sessions.get(client_id) # Check disconnect
#           if not session_data or session_data.get('disconnected'):
#               logger.warning(f"[Client {client_id}] Disconnected during LLM stream.")
#               llm_error = "Client disconnected"
#               break
#
#           if response.choices and response.choices[0].delta and response.choices[0].delta.content:
#               llm_chunk = response.choices[0].delta.content
#               processed_chunk = llm_chunk.replace("l'ECE", "l'E C E").replace("ECE", "E C E")
#               processed_chunk = llm_chunk.replace("ING", "ingé")
#               if processed_chunk:
#                   socketio.emit('text_chunk', {'text': processed_chunk}, to=client_id)
#                   full_response_text += processed_chunk
#
#       if not llm_error:
#            logger.info(f"[Client {client_id}] LLM stream finished.")
#            is_llm_complete = True
#
#       # --- 2. TTS Generation and Audio Streaming with Buffering ---
#       session_data = active_sessions.get(client_id) # Re-check state
#       if is_llm_complete and full_response_text.strip() and session_data and not session_data.get('disconnected'):
#           logger.info(f"[Client {client_id}] Starting TTS generation for accumulated text...")
#           try:
#               # Higher quality audio format
#               output_format = ELEVENLABS_OUTPUT_FORMAT
#               
#               # Add optimization options for speech synthesis
#               audio_stream = eleven_client.text_to_speech.convert_as_stream(
#                   text=full_response_text.strip(),
#                   voice_id=ELEVENLABS_VOICE_ID,
#                   model_id=ELEVENLABS_MODEL_ID,
#                   output_format=output_format,
#                   # Optional: You can adjust voice settings if ElevenLabs API supports it
#                   # voice_settings={"stability": 0.5, "similarity_boost": 0.8}
#               )
#
#               audio_sent = False
#               logger.info(f"[Client {client_id}] Streaming audio back to client...")
#               
#               # --- Implement buffering for smoother playback ---
#               buffer_size = 64 * 1024  # 64 KB buffer size
#               audio_buffer = b""
#               
#               for audio_chunk in audio_stream:
#                   session_data = active_sessions.get(client_id) # Check disconnect during audio stream
#                   if not session_data or session_data.get('disconnected'):
#                       logger.warning(f"[Client {client_id}] Disconnected during TTS audio emission.")
#                       tts_error = "Client disconnected during audio stream"
#                       break
#
#                   if isinstance(audio_chunk, bytes) and audio_chunk:
#                       # Add to buffer instead of sending immediately
#                       audio_buffer += audio_chunk
#                       
#                       # Only send when buffer reaches threshold size
#                       if len(audio_buffer) >= buffer_size:
#                           socketio.emit(
#                               'audio_chunk',
#                               {
#                                   'audio': base64.b64encode(audio_buffer).decode('utf-8'),
#                                   'format': output_format.split('_')[0]
#                               },
#                               to=client_id
#                           )
#                           audio_sent = True
#                           audio_buffer = b""  # Reset buffer
#               
#               # Send any remaining buffered audio
#               if audio_buffer and not tts_error:
#                   socketio.emit(
#                       'audio_chunk',
#                       {
#                           'audio': base64.b64encode(audio_buffer).decode('utf-8'),
#                           'format': output_format.split('_')[0]
#                       },
#                       to=client_id
#                   )
#                   audio_sent = True
#
#               if audio_sent and not tts_error:
#                   logger.info(f"[Client {client_id}] Finished streaming audio via SDK.")
#               elif not audio_sent and not tts_error:
#                   logger.warning(f"[Client {client_id}] No audio data received/sent from TTS SDK.")
#
#           except Exception as e:
#               tts_error = str(e)
#               logger.error(f"[Client {client_id}] Error during TTS streaming: {e}", exc_info=True)
#       # --- (Handle skipping TTS logic remains same) ---
#       elif llm_error: logger.warning(f"[Client {client_id}] Skipping TTS due to LLM error/disconnect.")
#       elif not full_response_text.strip(): logger.warning(f"[Client {client_id}] Skipping TTS (empty LLM response).")
#       elif session_data and session_data.get('disconnected'): logger.warning(f"[Client {client_id}] Skipping TTS (client disconnected before TTS start).")
#
#   except Exception as e: # Catch errors during LLM phase
#       llm_error = str(e)
#       logger.error(f"[Client {client_id}] Error during LLM processing: {llm_error}", exc_info=True)
#
#   finally:
#       # --- (Finally block logic remains the same) ---
#       logger.info(f"[Client {client_id}] Entering finally block (batched v2). LLM complete={is_llm_complete}, LLM Error={llm_error}, TTS Error={tts_error}")
#       session_data = active_sessions.get(client_id)
#       final_error = llm_error or tts_error
#       should_send_complete = is_llm_complete and not final_error
#
#       if session_data and not session_data.get('disconnected'):
#           if should_send_complete:
#               logger.info(f"[Client {client_id}] Emitting 'complete' signal (batched v2).")
#               socketio.emit('complete', {}, to=client_id)
#           elif final_error:
#               logger.error(f"[Client {client_id}] Emitting final error (batched v2): {final_error}")
#               socketio.emit('error', {'message': f'Processing failed: {final_error}'}, to=client_id)
#
#       if client_id in active_sessions:
#           active_sessions[client_id]['processing'] = False
#           active_sessions[client_id]['last_activity'] = time.time()
#           if active_sessions[client_id].get('disconnected'):
#               logger.info(f"Removing disconnected session {client_id} after processing (batched v2).")
#               try: del active_sessions[client_id]
#               except KeyError: pass
#           else:
#               logger.info(f"Finished processing for client {client_id} (batched v2). Session active.")
#       else:
#            logger.warning(f"Session {client_id} already removed before final cleanup (batched v2).")
#
# --- Periodic Cleanup (Unchanged) ---
def cleanup_stale_sessions():
    current_time = time.time()
    stale_timeout = 600
    cleaned_count = 0
    for client_id in list(active_sessions.keys()):
        session_data = active_sessions.get(client_id)
        if not session_data: continue
        is_stuck = session_data.get('processing', False) and (current_time - session_data['last_activity'] > stale_timeout)
        is_inactive = not session_data.get('processing', False) and (current_time - session_data['last_activity'] > stale_timeout)
        is_disconnected_long_ago = session_data.get('disconnected', False) and (current_time - session_data['last_activity'] > stale_timeout / 2 )
        if is_inactive or is_stuck or is_disconnected_long_ago:
             reason = "inactive" if is_inactive else "stuck processing" if is_stuck else "disconnected"
             logger.info(f"Removing stale session ({reason}): {client_id}")
             try:
                 del active_sessions[client_id]
                 cleaned_count += 1
             except KeyError: pass
    if cleaned_count > 0: logger.info(f"Cleaned up {cleaned_count} stale sessions.")

def cleanup_rate_limits():
    current_time = time.time()
    cutoff_time = current_time - RATE_WINDOW
    new_limits = defaultdict(list)
    for ip, timestamps in ip_rate_limits.items():
        valid_timestamps = [ts for ts in timestamps if ts > cutoff_time]
        if valid_timestamps: new_limits[ip] = valid_timestamps
    ip_rate_limits.clear()
    ip_rate_limits.update(new_limits)

def start_cleanup_thread():
    def cleanup_worker():
        logger.info("Cleanup thread started.")
        while True:
            time.sleep(60)
            try:
                cleanup_stale_sessions()
                cleanup_rate_limits()
            except Exception as e: logger.error(f"Error in cleanup thread: {e}", exc_info=True)
    cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
    cleanup_thread.start()

# --- Default Error Handler (Unchanged) ---
@socketio.on_error_default
def default_error_handler(e):
    client_id = "Unknown"
    try: client_id = request.sid
    except RuntimeError: pass
    logger.error(f"SocketIO Error (Client: {client_id}): {e}", exc_info=True)

# --- Main Execution Block (Unchanged) ---
if __name__ == "__main__":
    if not eleven_client: logger.warning("ElevenLabs client failed to initialize.")
    start_cleanup_thread()
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', 5002))
    logger.info(f"Starting server on {host}:{port}")
    logger.info(f"Using ElevenLabs SDK for TTS (Batched Text Input, Streamed Audio Output - v2).")
    # ... log other config ...
    socketio.run(app, debug=False, host=host, port=port, use_reloader=False)
