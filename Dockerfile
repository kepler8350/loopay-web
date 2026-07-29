FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# static 파일 캐시 무효화
ARG CACHEBUST=1
COPY . .

EXPOSE 8080
CMD ["gunicorn", "app:app", "--config", "gunicorn.conf.py", "--bind", "0.0.0.0:8080"]
