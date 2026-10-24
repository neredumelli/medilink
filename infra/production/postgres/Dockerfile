# PostgreSQL 16 with pgBackRest for continuous backup and point-in-time restore.
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest /etc/pgbackrest \
 && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest /etc/pgbackrest
COPY --chmod=755 medilink-entrypoint.sh /usr/local/bin/medilink-entrypoint.sh
COPY --chmod=755 write-pgbackrest-conf.sh /usr/local/bin/write-pgbackrest-conf.sh
ENTRYPOINT ["medilink-entrypoint.sh"]
CMD ["postgres"]
