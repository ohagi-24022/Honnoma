export const AUTH_REDIRECT_URL = 'honnoma://auth-callback';
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Native auth uses the implicit flow: the verified email link returns session tokens.
// Never log this URL, or place its tokens in router parameters.
export function parseAuthCallback(rawUrl: string): { type: 'recovery' | 'signup'; tokens: { access_token: string; refresh_token: string } } {
  const url = new URL(rawUrl);
  if (url.protocol !== 'honnoma:' || url.hostname !== 'auth-callback' || (url.pathname && url.pathname !== '/')) {
    throw new Error('本の間の確認メールにあるリンクを開いてください。');
  }
  const params = new URLSearchParams(url.hash.slice(1));
  if (params.has('error') || url.searchParams.has('error')) {
    throw new Error('リンクの有効期限が切れているか、使用済みです。メールをもう一度送信してください。');
  }
  const type = params.get('type');
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if ((type !== 'recovery' && type !== 'signup') || !access_token || !refresh_token) {
    throw new Error('確認情報を読み取れませんでした。メールをもう一度送信してください。');
  }
  return { type, tokens: { access_token, refresh_token } };
}

export function validateNewPassword(password: string, confirmation: string) {
  if (password.length < 6) return 'パスワードは6文字以上で入力してください。';
  if (password !== confirmation) return '確認用のパスワードが一致していません。';
  return null;
}
