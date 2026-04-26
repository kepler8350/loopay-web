FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080
CMD ["python", "-c", "import os,subprocess; subprocess.run(['gunicorn','app:app','--bind','0.0.0.0:'+os.environ.get('PORT','8080'),'--workers','2','--timeout','120'])"]
