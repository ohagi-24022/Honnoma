import {readFile,writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Keep the in-app text and both published HTML paths on the same revision.
const source=await readFile('src/lib/privacyPolicy.ts','utf8');
const exports={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const {privacyPolicySections:sections,privacyPolicyUpdatedAt:date}=exports;
const intro='本ポリシーは、YUKI UTSUNO（以下「運営者」といいます）が提供するアプリ「本の間」（以下「本アプリ」といいます）における利用者情報の取り扱いについて説明するものです。';
const form='https://docs.google.com/forms/d/e/1FAIpQLSdKp8lpTAanF885CYChSQUafiQhV-YWXgQmeVTUxFu1612s3Q/viewform';
const email='ohagiworks.contact@gmail.com';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const md='# 本の間 プライバシーポリシー\n\n最終更新日: '+date+'\n\n'+intro+'\n\n'+sections.map((s,i)=>`## ${i+1}. ${s.title}\n\n${s.body.replaceAll('\n','\n\n')}`).join('\n\n')+`\n\n## 10. 問い合わせ先\n\n運営者: YUKI UTSUNO\n問い合わせフォーム: ${form}\nメールアドレス: ${email}\n`;
const original=await readFile('website/privacy-policy/index.html','utf8');
const main=`<main>\n<h1>本の間 プライバシーポリシー</h1>\n<p>最終更新日: ${date}</p>\n<p>${intro}</p>\n`+sections.map((s,i)=>`<h2>${i+1}. ${escape(s.title)}</h2>\n`+s.body.split('\n').map(p=>`<p>${escape(p)}</p>`).join('\n')).join('\n')+`\n<h2>10. 問い合わせ先</h2>\n<p>運営者: YUKI UTSUNO</p>\n<p>問い合わせフォーム：<a href="${form}">お問い合わせフォームを開く</a></p>\n<p>メールアドレス：<a href="mailto:${email}">${email}</a></p>\n</main>`;
const html=original.replace(/<main>[\s\S]*?<\/main>/,main);
for(const [path,content] of [['docs/privacy-policy.md',md],['website/privacy-policy/index.html',html],['website/privacy-policy/docs/privacy-policy.html',html]]){
  if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==content)throw new Error(`${path} needs synchronization`);}
  else await writeFile(path,content);
}
console.log(process.argv.includes('--check')?'Privacy text and published HTML are synchronized.':'Privacy documents synchronized.');
