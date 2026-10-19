// Generated metadata/byte fixtures. No tests depend on a user's music file.
export const tinyPNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
export const audioPayload = Buffer.concat(Array.from({length:8},()=>Buffer.concat([Buffer.from([255,251,144,100]),Buffer.alloc(413)])));
export const syncSize = n=>Buffer.from([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127]);
export function makeID3(frames, version=4) {
  const content=Buffer.concat(frames.map(({id,data})=>{
    if (version===2) return Buffer.concat([Buffer.from(id),Buffer.from([(data.length>>16)&255,(data.length>>8)&255,data.length&255]),data]);
    const length=Buffer.alloc(4);length.writeUInt32BE(data.length);
    return Buffer.concat([Buffer.from(id),version===4?syncSize(data.length):length,Buffer.from([0,0]),data]);
  }));
  return Buffer.concat([Buffer.from('ID3'),Buffer.from([version,0,0]),syncSize(content.length),content]);
}
export function fixtureLyrics(count=30) {
  return Array.from({length:count},(_,i)=>{
    const seconds=i*5;
    const stamp=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    return `[${stamp}]Original line ${i+1}\n[${stamp}]Translation ${i+1}`;
  }).join('\n');
}
export function makeMP3({version=4,title='Fixture track',lyrics=fixtureLyrics(),language='eng',artwork=tinyPNG,tagged=true,v1Title=''}={}) {
  const frames=[];
  const encoding=version===2?1:3;
  const text=value=>version===2?Buffer.concat([Buffer.from([255,254]),Buffer.from(value,'utf16le')]):Buffer.from(value);
  if (title!==null) frames.push({id:version===2?'TT2':'TIT2',data:Buffer.concat([Buffer.from([encoding]),text(title)])});
  if (lyrics!==null) frames.push({id:version===2?'ULT':'USLT',data:Buffer.concat([Buffer.from([encoding]),Buffer.from(language),Buffer.alloc(encoding===1?2:1),text(lyrics)])});
  if (artwork) frames.push({id:version===2?'PIC':'APIC',data:Buffer.concat([Buffer.from([0]),Buffer.from(version===2?'PNG':'image/png\0'),Buffer.from([3,0]),artwork])});
  const tail=Buffer.alloc(v1Title?128:0);
  if (v1Title) {tail.write('TAG',0,'ascii');tail.write(v1Title.slice(0,30),3,'latin1');}
  return Buffer.concat([tagged?makeID3(frames,version):Buffer.alloc(0),audioPayload,tail]);
}
