import { supabase } from './supabase';

type DeleteAccountResponse = {
  ok?: boolean;
  error?: string;
};

export async function deleteCurrentAccount() {
  if (!supabase) {
    throw new Error('現在アカウントの操作を利用できません。');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error('ログイン状態を確認できませんでした。もう一度ログインしてからお試しください。');
  }
  if (!sessionData.session) {
    throw new Error('アカウント削除にはログインが必要です。');
  }

  const { data, error } = await supabase.functions.invoke<DeleteAccountResponse>('delete-account', {
    body: {},
  });

  if (error) {
    throw new Error(`アカウント削除に失敗しました。${error.message}`);
  }
  if (!data?.ok) {
    throw new Error(data?.error ?? 'アカウント削除に失敗しました。');
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
  if (signOutError) {
    throw new Error('アカウントは削除されましたが、端末のログアウト処理に失敗しました。アプリを再起動してください。');
  }
}
