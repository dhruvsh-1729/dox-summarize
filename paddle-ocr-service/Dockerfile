FROM python:3.10-slim

# System libraries required by PaddlePaddle / OpenCV / PyMuPDF.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Generous network timeouts/retries for slow links (the paddlepaddle wheel is ~126 MB).
ENV PIP_DEFAULT_TIMEOUT=120
ENV PIP_RETRIES=10

COPY requirements.txt .
# Install the large paddlepaddle wheel in its own layer so a later failure/retry
# does not re-download it (Docker caches this layer).
RUN pip install --no-cache-dir --timeout 120 --retries 10 paddlepaddle==2.6.2
RUN pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt

COPY app.py .

EXPOSE 8868

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8868"]
