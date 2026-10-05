#!/usr/bin/env bash
set -euo pipefail
umask 077
config=$(mktemp)
trap 'rm -f "$config"' EXIT
[[ "$BOILER_ADMIN_PASSWORD" =~ ^[a-zA-Z0-9_-]{32,128}$ ]] || { echo "Invalid admin credential format" >&2; exit 1; }
printf 'security.protocol=SASL_PLAINTEXT\nsasl.mechanism=PLAIN\nsasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="%s";\n' "$BOILER_ADMIN_PASSWORD" > "$config"
common=(--bootstrap-server kafka:29092 --command-config "$config")
case "${1:-}" in
  health) /opt/kafka/bin/kafka-topics.sh "${common[@]}" --list >/dev/null ;;
  init-topic)
    topic=${2:?Topic name required}
    [[ "$topic" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,248}$ ]] || { echo "Invalid topic" >&2; exit 1; }
    /opt/kafka/bin/kafka-topics.sh "${common[@]}" --create --if-not-exists --topic "$topic" --partitions 1 --replication-factor 1 --config retention.ms=86400000 --config retention.bytes=67108864 --config max.message.bytes=65536
    /opt/kafka/bin/kafka-acls.sh "${common[@]}" --add --allow-principal User:producer --operation Write --operation Describe --topic "$topic"
    /opt/kafka/bin/kafka-acls.sh "${common[@]}" --add --allow-principal User:producer --operation IdempotentWrite --cluster
    /opt/kafka/bin/kafka-acls.sh "${common[@]}" --add --allow-principal User:consumer --operation Read --operation Describe --topic "$topic"
    /opt/kafka/bin/kafka-acls.sh "${common[@]}" --add --allow-principal User:consumer --operation Read --group boiler-monitor- --resource-pattern-type prefixed
    ;;
  *) echo "Usage: admin.sh health | init-topic TOPIC" >&2; exit 2 ;;
esac
