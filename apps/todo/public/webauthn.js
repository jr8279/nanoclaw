// Minimal WebAuthn browser glue — just the base64url<->ArrayBuffer plumbing
// a passkey ceremony needs, hand-written rather than pulling in
// @simplewebauthn/browser as a CDN dependency for ~40 lines of conversion.

function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + '='.repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Create a new passkey from server-provided registration options (JSON, base64url-encoded). */
async function createPasskey(optionsJSON) {
  const publicKey = {
    ...optionsJSON,
    challenge: base64urlToBuffer(optionsJSON.challenge),
    user: { ...optionsJSON.user, id: base64urlToBuffer(optionsJSON.user.id) },
    excludeCredentials: (optionsJSON.excludeCredentials || []).map((c) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    })),
  };
  const credential = await navigator.credentials.create({ publicKey });
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      attestationObject: bufferToBase64url(credential.response.attestationObject),
      transports: credential.response.getTransports ? credential.response.getTransports() : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
  };
}

/** Use an existing passkey to sign a server-provided authentication challenge. */
async function getPasskey(optionsJSON) {
  const publicKey = {
    ...optionsJSON,
    challenge: base64urlToBuffer(optionsJSON.challenge),
    allowCredentials: (optionsJSON.allowCredentials || []).map((c) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    })),
  };
  const credential = await navigator.credentials.get({ publicKey });
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      authenticatorData: bufferToBase64url(credential.response.authenticatorData),
      signature: bufferToBase64url(credential.response.signature),
      userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
  };
}
