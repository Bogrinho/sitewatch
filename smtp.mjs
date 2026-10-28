// Minimal STARTTLS SMTP client for the Cloudflare sockets runtime.
// Passwords are never returned or logged.
export async function sendGmail(connect, {user,password,to,subject,body}) {
  let socket,reader,writer,buffer='';
  const timeout=setTimeout(()=>{try{socket?.close();}catch{}},12000);
  const encoder=new TextEncoder(), decoder=new TextDecoder();
  async function reply() {
    while(true) {
      const index=buffer.indexOf('\r\n');
      if(index>=0) {
        const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
        if(/^\d{3} /.test(line))return Number(line.slice(0,3));
        if(!/^\d{3}-/.test(line))throw Error('Unexpected SMTP response');
      } else {
        const {value,done}=await reader.read();
        if(done)throw Error('SMTP connection closed');
        buffer+=decoder.decode(value,{stream:true});
        if(buffer.length>16384)throw Error('SMTP response too large');
      }
    }
  }
  async function command(value,expected) {
    await writer.write(encoder.encode(value+'\r\n'));
    const code=await reply();if(!expected.includes(code))throw Error('SMTP rejected a command');
  }
  try {
    socket=connect({hostname:'smtp.gmail.com',port:587},{secureTransport:'starttls'});
    await socket.opened;reader=socket.readable.getReader();writer=socket.writable.getWriter();
    if(await reply()!==220)throw Error('SMTP unavailable');
    await command('EHLO sitewatch.local',[250]);
    await command('STARTTLS',[220]);
    reader.releaseLock();writer.releaseLock();
    socket=socket.startTls();await socket.opened;
    reader=socket.readable.getReader();writer=socket.writable.getWriter();buffer='';
    await command('EHLO sitewatch.local',[250]);
    await command('AUTH PLAIN '+btoa('\0'+user+'\0'+password.replace(/ /g,'')),[235]);
    await command(`MAIL FROM:<${user}>`,[250]);
    await command(`RCPT TO:<${to}>`,[250,251]);
    await command('DATA',[354]);
    const safeSubject=subject.replace(/[\r\n]/g,' ');
    const safeBody=body.replace(/\r?\n/g,'\r\n').replace(/^\./gm,'..');
    await command(`From: ${user}\r\nTo: ${to}\r\nSubject: ${safeSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${safeBody}\r\n.`,[250]);
    await command('QUIT',[221]).catch(()=>{});
  } finally {
    clearTimeout(timeout);
    try{reader?.releaseLock();writer?.releaseLock();}catch{}
    try{await socket?.close();}catch{}
  }
}
