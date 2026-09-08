import { setupNetwork } from '@msw/cloudflare';
import { http, HttpResponse } from 'msw';
export const network = setupNetwork();

// Exercise Clerk's real signature verifier, replacing only its external HTTP calls.
let pair: CryptoKeyPair;
const kid = 'kobesplit-test-key';
const encode = (input: string | Uint8Array) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
export async function startClerkFixture() {
  const generated = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  if (!('privateKey' in generated)) throw new Error('Expected an RSA keypair');
  pair = generated;
  const key = await crypto.subtle.exportKey('jwk', pair.publicKey);
  await network.enable();
  network.use(http.all('*', () => { throw new Error('Unexpected outbound test request'); }));
  network.use(http.get('https://api.clerk.com/v1/jwks', () => HttpResponse.json({ keys: [{ ...key, kid, alg: 'RS256', use: 'sig' }] }))); 
}
export function stopClerkFixture() { return network.disable(); }
export async function sessionToken(userId: string, claims: Record<string, unknown> = {}) {
  const time = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://clerk.fixture.test', sub: userId, sid: 'sess_fixture', azp: 'https://example.com', iat: time, nbf: time - 5, exp: time + 600, v: 2, sts: 'active', ...claims };
  const signed = `${encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))}.${encode(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed));
  return `${signed}.${encode(new Uint8Array(signature))}`;
}
export function mockClerkUser(userId: string, options: { email?: string; verified?: boolean; firstName?: string | null; lastName?: string | null; banned?: boolean } = {}) {
  network.use(http.get(`https://api.clerk.com/v1/users/${userId}`, () => HttpResponse.json({
    id: userId, object: 'user', first_name: options.firstName === undefined ? 'Alex' : options.firstName,
    last_name: options.lastName === undefined ? 'Rivera' : options.lastName,
    email_addresses: [{ id: 'email_fixture', object: 'email_address', email_address: options.email || 'alex@example.test', verification: { status: options.verified === false ? 'unverified' : 'verified', strategy: 'email_code' }, linked_to: [] }],
    phone_numbers: [], web3_wallets: [], external_accounts: [], enterprise_accounts: [],
    public_metadata: {}, private_metadata: { confidential: 'private-value' }, unsafe_metadata: {},
    banned: options.banned ?? false, locked: false,
  })));
}
export function uniqueClerkUser() { return `user_${crypto.randomUUID().replaceAll('-', '')}`; }
