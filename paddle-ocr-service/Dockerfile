FROM python:3.10-slim

# System libraries required by PaddlePaddle / OpenCV / PyMuPDF.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8868

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8868"]
