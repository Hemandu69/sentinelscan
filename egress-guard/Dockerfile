# Applies the outbound firewall inside ZAP's network namespace. Runs briefly, then exits.
FROM postgres:17-alpine
RUN apk add --no-cache nftables && nft --version
COPY guard.sh /usr/local/bin/guard
RUN sed -i 's/\r$//' /usr/local/bin/guard && chmod 0555 /usr/local/bin/guard
LABEL sentinelscan.egress-guard=1
ENTRYPOINT ["/bin/sh", "/usr/local/bin/guard"]
CMD ["status"]
