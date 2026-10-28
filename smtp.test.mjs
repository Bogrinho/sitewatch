import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendGmail} from './smtp.mjs';

function fakeSmtp(rejectAuth=false) {
  const commands=[];
  let controller;
  function socket(greeting) {
    const readable=new ReadableStream({start(c){controller=c;if(greeting)c.enqueue(new TextEncoder().encode('220 ready\r\n'));}});
    const writable=new WritableStream({write(bytes){
      const command=new TextDecoder().decode(bytes);commands.push(command);
      let answer='250 OK\r\n';
      if(command.startsWith('EHLO'))answer='250-test\r\n250 STARTTLS\r\n';
      else if(command.startsWith('STARTTLS'))answer='220 Ready\r\n';
      else if(command.startsWith('AUTH'))answer=rejectAuth?'535 rejected\r\n':'235 accepted\r\n';
      else if(command.startsWith('DATA'))answer='354 send data\r\n';
      else if(command.startsWith('QUIT'))answer='221 bye\r\n';
      controller.enqueue(new TextEncoder().encode(answer));
    }});
    return {readable,writable,opened:Promise.resolve(),startTls(){return socket(false);},close(){return Promise.resolve();}};
  }
  return {connect:()=>socket(true),commands};
}

test('STARTTLS, authentication and delivery use the configured recipient',async()=>{
  const mock=fakeSmtp();
  await sendGmail(mock.connect,{user:'sender@example.com',password:'test password',to:'recipient@example.com',subject:'Test',body:'Hello\n.world'});
  assert.ok(mock.commands.some(c=>c==='STARTTLS\r\n'));
  assert.ok(mock.commands.some(c=>c==='RCPT TO:<recipient@example.com>\r\n'));
  assert.ok(mock.commands.some(c=>c.includes('\r\n..world\r\n.\r\n')));
});
test('a rejected login is reported as a delivery failure',async()=>{
  const mock=fakeSmtp(true);
  await assert.rejects(sendGmail(mock.connect,{user:'sender@example.com',password:'test',to:'recipient@example.com',subject:'Test',body:'Hi'}));
  assert.equal(mock.commands.some(c=>c.startsWith('MAIL FROM')),false);
});
