FROM python:3.11-slim

# Node for JS execution (small runtime; data libs are Python-side).
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Headless matplotlib; no interactive backend in the sandbox.
# MPLCONFIGDIR lives outside the per-run work dir so matplotlib's font cache
# (fontlist-vNNN.json) is never produced as a user file; it's warmed at build.
ENV MPLBACKEND=Agg \
    HOME=/tmp \
    MPLCONFIGDIR=/opt/mplconfig \
    PYTHONDONTWRITEBYTECODE=1

# Run as a non-root user — defence in depth for executing model-written code.
RUN useradd -m -u 10001 sandbox && mkdir -p /work && chown sandbox:sandbox /work \
    && mkdir -p /opt/mplconfig && chown sandbox:sandbox /opt/mplconfig
USER sandbox

# Pre-build the matplotlib font cache into /opt/mplconfig so the first plot at
# runtime is fast and writes nothing into the work dir.
RUN python -c "import matplotlib.pyplot as plt; plt.plot([0,1]); plt.savefig('/tmp/_warm.png')" && rm -f /tmp/_warm.png

EXPOSE 8002
CMD ["python", "main.py"]
