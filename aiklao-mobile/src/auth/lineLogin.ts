import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';

WebBrowser.maybeCompleteAuthSession();

const LINE_AUTH_ENDPOINT = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_ENDPOINT = 'https://api.line.me/oauth2/v2.1/token';

const discovery = {
  authorizationEndpoint: LINE_AUTH_ENDPOINT,
  tokenEndpoint: LINE_TOKEN_ENDPOINT,
};

export interface LineLoginResult {
  idToken: string | null;
  accessToken: string | null;
}

/**
 * Run LINE Login OAuth 2.0 flow
 * Returns id_token (JWT signed by LINE) — backend จะ verify เอง
 *
 * Setup ก่อนใช้:
 * 1. ไป LINE Developers Console → สร้าง LINE Login channel
 * 2. ตั้ง Callback URL ให้ตรงกับ redirect URI ที่ใช้ใน app
 *    - dev: exp://<ip>:8081/--/auth/callback
 *    - prod: aiklao://auth/callback
 * 3. ใส่ Channel ID ใน app.json → extra.lineChannelId
 */
export async function lineLogin(): Promise<LineLoginResult> {
  const channelId = Constants.expoConfig?.extra?.lineChannelId as
    | string
    | undefined;
  if (!channelId || channelId.startsWith('REPLACE_')) {
    throw new Error(
      'LINE channelId not set in app.json (extra.lineChannelId). See PHASE_5.1.md',
    );
  }

  // 1. Build redirect URI matching app scheme
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'aiklao',
    path: 'auth/callback',
  });

  // 2. Generate PKCE + nonce
  const state = await randomHex(16);
  const nonce = await randomHex(16);

  // 3. Build auth request
  const request = new AuthSession.AuthRequest({
    clientId: channelId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: ['profile', 'openid'],
    extraParams: {
      nonce,
      bot_prompt: 'normal',
    },
    state,
    usePKCE: true,
  });

  await request.makeAuthUrlAsync(discovery);

  // 4. Open browser to LINE for user to log in
  const result = await request.promptAsync(discovery);

  if (result.type !== 'success' || !result.params.code) {
    return { idToken: null, accessToken: null };
  }

  if (result.params.state !== state) {
    throw new Error('LINE login state mismatch');
  }

  // 5. Exchange auth code for id_token via LINE token endpoint
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: result.params.code,
    redirect_uri: redirectUri,
    client_id: channelId,
    code_verifier: request.codeVerifier ?? '',
  });

  const tokenResp = await fetch(LINE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(`LINE token exchange failed: ${tokenResp.status} ${text}`);
  }

  const tokenJson = (await tokenResp.json()) as {
    access_token: string;
    id_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    idToken: tokenJson.id_token,
    accessToken: tokenJson.access_token,
  };
}

async function randomHex(bytes: number): Promise<string> {
  const buf = await Crypto.getRandomBytesAsync(bytes);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
