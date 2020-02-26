#!/bin/sh

CA_KEY_FILE='ca.key'
CA_CERT_FILE='ca.crt'

# Generate private key for root CA
# Options:
#  -out : name of file to write generated key to
#  4096 : number of bits in the key
openssl genrsa -out $CA_KEY_FILE 4096

# Generate CA certificate and sign it with previously generated key.
# Options:
#  -batch : script (non-interactive) mode
#  -new : creates new sertificate request
#  -x509 : produces self signed sertificate instead of certificate request
#  -deys : number of days this certificate will be valid for
#  -key : private key to use to sign this certificate
#  -subj : subject name. Should contain at least distinguished (common) name (CN). Format: /type0=value0/type1=value1
#  -addext : adds extension to certificate (inline version of -reqexts with -config)
#  -outform : format of the certificate container
#  -out : name of file to write generated certificate to
CA_CN='eclipse-che-local-CA'
openssl req -batch -new -x509 -days 730 -key $CA_KEY_FILE \
            -subj "/CN=${CA_CN}" \
            -addext keyUsage=keyCertSign,cRLSign,digitalSignature \
            -outform PEM -out $CA_CERT_FILE
            # Do not include CA:TRUE as it is already included into default config file
            #-addext basicConstraints=critical,CA:TRUE

# Create CA root certificate secret

CERT_MANAGER_NAMESPACE='cert-manager'
CERT_MANAGER_CA_SECRET_NAME='ca'

kubectl create secret tls $CERT_MANAGER_CA_SECRET_NAME --key=$CA_KEY_FILE --cert=$CA_CERT_FILE --namespace $CERT_MANAGER_NAMESPACE
