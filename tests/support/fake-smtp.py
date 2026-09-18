import socket,sys
mode=sys.argv[1]; port=int(sys.argv[2]); s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',port));s.listen(1)
c,_=s.accept(); c.sendall(b'220 fake\r\n'); data=False
while True:
 x=c.recv(8192)
 if not x: break
 line=x.decode(errors='ignore').upper()
 if data:
  if '\r\n.\r\n' in line or line.endswith('\r\n.\r\n'):
   if mode=='drop': c.close(); break
   c.sendall(b'451 temporary\r\n' if mode=='451' else b'250 queued\r\n'); data=False
  continue
 if line.startswith('EHLO') or line.startswith('HELO'): c.sendall(b'250 fake\r\n')
 elif line.startswith('AUTH'): c.sendall(b'334 VXNlcm5hbWU6\r\n')
 elif line.strip() in ('DTE=', 'CGFZCW==', 'DGVZDA==', 'CGFZCW') : c.sendall(b'235 ok\r\n')
 elif line.startswith('MAIL') or line.startswith('RCPT'): c.sendall(b'250 ok\r\n')
 elif line.startswith('DATA'): c.sendall(b'354 continue\r\n'); data=True
 elif data and '\r\n.\r\n' in line:
  if mode=='drop': c.close(); break
  c.sendall(b'451 temporary\r\n' if mode=='451' else b'250 queued\r\n'); data=False
 elif line.startswith('QUIT'): c.sendall(b'221 bye\r\n'); break
 else: c.sendall(b'250 ok\r\n')
s.close()