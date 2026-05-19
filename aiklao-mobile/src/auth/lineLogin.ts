// LINE Login OAuth 2.0 flow with PKCE (production-grade)
// Flow:
//   1. Open browser to LINE auth → redirect_uri = HTTPS callback
//   2. LINE redirects → backend → returns HTML with aiklao:// redirect
//   3. Browser opens app via custom scheme
//   4. WebBrowser captures return URL → exchange code for id_token

import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";

WebBrowser.maybeCompleteAuthSession();

const LINE_AUTH_ENDPOINT = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_ENDPOINT = "https://api.line.me/oauth2/v2.1/token";
const HTTPS_CALLBACK_URL = "https://api.aiklaotrip.com/api/mobile/oauth/callback";
const APP_RETURN_URL = "aiklao://auth/callback";

export interface LineLoginResult {
  idToken: string | null;
  accessToken: string | null;
}

async function randomHex(bytes: number): Promise<string> {
  const buf = await Crypto.getRandomBytesAsync(bytes);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(input: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );

  return hash
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function lineLogin(): Promise<LineLoginResult> {
  const channelId = Constants.expoConfig?.extra?.lineChannelId as
    | string
    | undefined;

  if (!channelId || channelId.startsWith("REPLACE_")) {
    throw new Error("LINE channelId not set in app.json");
  }

  const state = await randomHex(16);
  const nonce = await randomHex(16);
  const codeVerifier = await randomHex(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const authUrl = new URL(LINE_AUTH_ENDPOINT);

  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", channelId);
  authUrl.searchParams.set("redirect_uri", HTTPS_CALLBACK_URL);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("scope", "profile openid");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("bot_prompt", "normal");

  const result = await WebBrowser.openAuthSessionAsync(
    authUrl.toString(),
    APP_RETURN_URL
  );

  if (result.type !== "success" || !result.url) {
    return { idToken: null, accessToken: null };
  }

  const returnUrl = new URL(result.url);

  const errorParam = returnUrl.searchParams.get("error");
  if (errorParam) {
    throw new Error(`LINE OAuth error: ${errorParam}`);
  }

  const code = returnUrl.searchParams.get("code");
  const returnedState = returnUrl.searchParams.get("state");

  if (!code) {
    return { idToken: null, accessToken: null };
  }

  if (returnedState !== state) {
    throw new Error("State mismatch");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: HTTPS_CALLBACK_URL,
    client_id: channelId,
    code_verifier: codeVerifier,
  });

  const tokenResp = await fetch(LINE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();

    throw new Error(
      `LINE token exchange failed: ${tokenResp.status} ${text}`
    );
  }

  const tokenJson = await tokenResp.json();

  return {
    idToken: tokenJson.id_token,
    accessToken: tokenJson.access_token,
  };
}