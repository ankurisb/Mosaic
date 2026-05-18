FROM apache/superset:3.1.3

USER root

COPY superset_config.py /app/pythonpath/superset_config.py
COPY init.sh /app/pythonpath/init.sh
RUN chmod +x /app/pythonpath/init.sh

USER superset
