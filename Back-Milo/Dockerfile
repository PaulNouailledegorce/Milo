FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install dependencies and verify gunicorn is available
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install gunicorn eventlet && \
    which gunicorn 
    #Le serveur Gunicorn (WSGI) avec eventlet (pour gérer les WebSockets via Flask-SocketIO)
# Copy application code
COPY *.py .
#COPY .env .env.example ./
COPY .env ./
# Expose the port the app runs on
EXPOSE 5000

# Command to run the application
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--bind", "0.0.0.0:5000", "app:app"]
