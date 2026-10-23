// Render Free blocks SMTP. Use the existing project's protected function over
// HTTPS for Gmail; the credentials remain server-side and are never logged.
export async function sendAdminMail(env,mail,{transport,fetcher=fetch}={}) {
  if(transport)return transport.sendMail(mail);
  if(String(env.CONTENT_REVIEW_SMTP_HOST).toLowerCase()==='smtp.gmail.com' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY){
    const origin=new URL(env.SUPABASE_URL);
    if(origin.origin!=='https://ccaregwftbjqwaztvwdu.supabase.co')throw new Error('Unsupported mail project');
    const result=await fetcher(new URL('/functions/v1/admin-mail',origin),{
      method:'POST',signal:AbortSignal.timeout(55000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:env.SUPABASE_SERVICE_ROLE_KEY},
      body:JSON.stringify({smtp:{user:env.CONTENT_REVIEW_SMTP_USER,pass:env.CONTENT_REVIEW_SMTP_PASSWORD},mail}),
    });
    const data=await result.json().catch(()=>({}));
    if(!result.ok || data.sent!==true){
      const error=new Error('Administrator mail delivery failed');
      error.code=['EAUTH','ETIMEDOUT','ECONNECTION','ESOCKET','EENVELOPE','EMESSAGE','EDNS'].includes(data.code)?data.code:'MAIL_RELAY_FAILED';
      throw error;
    }
    return {accepted:[env.CONTENT_REVIEW_MAIL_TO]};
  }
  const smtp=(await import('nodemailer')).default.createTransport({
    host:env.CONTENT_REVIEW_SMTP_HOST,port:Number(env.CONTENT_REVIEW_SMTP_PORT||465),secure:(env.CONTENT_REVIEW_SMTP_PORT||'465')==='465',requireTLS:true,
    auth:{user:env.CONTENT_REVIEW_SMTP_USER,pass:env.CONTENT_REVIEW_SMTP_PASSWORD},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
  });
  try {return await smtp.sendMail(mail);} finally {smtp.close();}
}
