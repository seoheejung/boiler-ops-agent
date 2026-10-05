import os
import ssl


def kafka_options(role, brokers):
    if role not in ("producer", "consumer"):
        raise ValueError("Unsupported Kafka role")
    protocol = os.getenv("KAFKA_SECURITY_PROTOCOL", "SASL_PLAINTEXT")
    if protocol not in ("SASL_PLAINTEXT", "SASL_SSL"):
        raise ValueError("Kafka requires SASL_PLAINTEXT or SASL_SSL")
    if protocol == "SASL_PLAINTEXT" and any(host.rsplit(":", 1)[0] not in ("127.0.0.1", "localhost", "[::1]") for host in brokers.split(",")):
        raise ValueError("Remote Kafka requires SASL_SSL")
    password = os.getenv(f"KAFKA_{role.upper()}_PASSWORD", "")
    if len(password) < 32:
        raise ValueError(f"KAFKA_{role.upper()}_PASSWORD must contain at least 32 characters")
    options = {"security_protocol": protocol, "sasl_mechanism": "PLAIN",
               "sasl_plain_username": role, "sasl_plain_password": password}
    if protocol == "SASL_SSL":
        options["ssl_context"] = ssl.create_default_context(cafile=os.getenv("KAFKA_CA_FILE") or None)
    return options
