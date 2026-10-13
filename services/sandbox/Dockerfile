FROM python:3.11-slim

# Node for JS execution (small runtime; data libs are Python-side).
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Headless matplotlib; no interactive backend in the sandbox.
ENV MPLBACKEND=Agg \
    HOME=/tmp \
    PYTHONDONTWRITEBYTECODE=1

# Run as a non-root user — defence in depth for executing model-written code.
RUN useradd -m -u 10001 sandbox && mkdir -p /work && chown sandbox:sandbox /work
USER sandbox

EXPOSE 8002
CMD ["python", "main.py"]
