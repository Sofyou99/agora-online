// Builds the ICE server list used by every RTCPeerConnection.
// STUN is always included (free, public). TURN is added only if you've
// configured it via env vars — see .env.example and SETUP.md. Without
// TURN, calls will still connect most of the time on open networks, but
// will sometimes fail entirely on stricter corporate/school/carrier
// networks, since there's no relay to fall back to.
export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
  }

  return servers;
}

export const hasTurnConfigured = Boolean(
  process.env.NEXT_PUBLIC_TURN_URL &&
  process.env.NEXT_PUBLIC_TURN_USERNAME &&
  process.env.NEXT_PUBLIC_TURN_CREDENTIAL
);
