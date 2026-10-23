// Deno resolves npm: imports on the server; Expo's TypeScript resolver does not.
// @ts-ignore Runtime-specific module specifier.
import nodemailer from 'npm:nodemailer@7.0.13';

declare const Deno: {env:{get(name:string):string|undefined};serve(handler:(req:Request)=>Promise<Response>):void};

const RECIPIENT = 'ohagiworks.contact@gmail.com';
const address = (value: unknown) => typeof value === 'string' && !/[\r\n]/.test(value)
  ? value.match(/^(?:[^<>]*<)?([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?$/i)?.[1]?.toLowerCase() : undefined;
async function sameSecret(a: string, b: string) {
  if (!a || !b) return false;
  const hash = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [x,y] = await Promise.all([hash(a),hash(b)]);
  return new Uint8Array(x).reduce((diff,v,i)=>diff | (v ^ new Uint8Array(y)[i]),0)===0;
}
export function createMailHandler(env: {get(name:string):string|undefined}, createTransport = nodemailer.createTransport) {
  return async (req: Request): Promise<Response> => {
    if(req.method!=='POST')return Response.json({error:'method'}, {status:405});
    const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1] ?? '';
    if(!await sameSecret(token,env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''))return Response.json({error:'forbidden'}, {status:403});
    try {
      const reader=req.body?.getReader();if(!reader)return Response.json({error:'invalid'}, {status:400});
      const chunks:Uint8Array[]=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return Response.json({error:'too_large'}, {status:413});}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const {smtp,mail}=JSON.parse(new TextDecoder().decode(bytes));
      const user=address(smtp?.user),from=address(mail?.from),to=address(mail?.to);
      if(!user || from!==user || to!==RECIPIENT || typeof smtp?.pass!=='string' || smtp.pass.length<1 || smtp.pass.length>256
        || typeof mail?.subject!=='string' || mail.subject.length>200 || /[\r\n]/.test(mail.subject)
        || typeof mail?.text!=='string' || mail.text.length>20000 || typeof mail?.messageId!=='string'
        || !/^<[A-Za-z0-9.-]+@honnoma\.review>$/.test(mail.messageId))return Response.json({error:'invalid'}, {status:400});
      // Gmail only, fixed TLS port and fixed administrator recipient. No arbitrary
      // SMTP target, user attachments, logging, persistence or client access.
      const transport=createTransport({host:'smtp.gmail.com',port:465,secure:true,requireTLS:true,
        auth:{user,pass:smtp.pass},logger:false,debug:false,
        connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
      try {
        const result=await transport.sendMail({from:mail.from,to:RECIPIENT,subject:mail.subject,text:mail.text,messageId:mail.messageId});
        if(!result.accepted?.length)return Response.json({error:'not_accepted'}, {status:502});
        return Response.json({sent:true});
      } catch(error) {
        const e=error as {code?:string;responseCode?:number};
        const code=['EAUTH','ETIMEDOUT','ECONNECTION','ESOCKET','EENVELOPE','EMESSAGE','EDNS'].includes(e.code ?? '')?e.code:'SMTP_FAILED';
        return Response.json({error:'mail_failed',code,smtp_code:Number(e.responseCode)||undefined},{status:502});
      } finally { transport.close(); }
    } catch { return Response.json({error:'invalid'}, {status:400}); }
  };
}
Deno.serve(createMailHandler(Deno.env));
