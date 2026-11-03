export class CameraShare {
  constructor(room){this.room=room;this.stream=null;this.version=0;this.pending=null;}
  async reserve(peer){
    if(!this.room.participants.find(p=>p.id===peer.id)?.cameraSupport||!peer.pc.addTransceiver)return;
    this.transport??=new MediaStream();peer.cameraTransceiver=peer.pc.addTransceiver('video',{direction:'sendonly',streams:[this.transport]});
    peer.cameraSender=peer.cameraTransceiver.sender;if(this.stream)await peer.cameraSender.replaceTrack(this.stream.getVideoTracks()[0]);
  }
  async start(){
    const room=this.room;if(!room.localStream)throw Error('Compartilhe sua tela antes de ligar a câmera.');
    if(this.pending)return this.pending;if(this.stream)return;
    const source=room.localStream,run=room.run,version=++this.version;
    this.pending=(async()=>{
      let stream;
      try{
        await room.native('cameraPermissionBegin');
        stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640,max:640},height:{ideal:360,max:360},frameRate:{ideal:15,max:15}}});
        if(version!==this.version||room.localStream!==source||room.run!==run){for(const track of stream.getTracks())track.stop();return;}
        this.stream=stream;stream.getVideoTracks()[0].onended=()=>{if(this.stream===stream)void this.stop();};
        room.event('camera',{stream});
        for(const peer of room.peers.values()){
          if(peer.direction!=='send'||!room.validPeer(peer))continue;
          if(!peer.cameraSender){room.notice('Um espectador precisa atualizar o StreamRoom para receber a câmera. A tela continua normalmente.');continue;}
          try{await peer.cameraSender.replaceTrack(stream.getVideoTracks()[0]);await room.configureSender(peer);if(peer.sent)await room.signal(peer,{kind:'camera',active:true});}
          catch{room.notice('A câmera não foi confirmada para um espectador. A transmissão de tela foi preservada.');}
        }
      }catch(error){
        if(stream&&stream!==this.stream)for(const track of stream.getTracks())track.stop();
        if(error.name==='NotAllowedError')throw Error('Câmera não autorizada. Confira a permissão de câmera do StreamRoom nas configurações de privacidade do Windows.');
        if(error.name==='NotFoundError')throw Error('Nenhuma câmera foi encontrada neste PC.');
        throw error;
      }finally{try{await room.native('cameraPermissionEnd');}catch{}}
    })().finally(()=>{this.pending=null;});return this.pending;
  }
  async stop(){
    this.version++;const stream=this.stream;this.stream=null;
    for(const track of stream?.getTracks()??[]){track.onended=null;track.stop();}
    this.room.event('camera',{stream:null});
    await Promise.allSettled([...this.room.peers.values()].filter(p=>p.direction==='send'&&p.cameraSender&&this.room.validPeer(p)).map(async p=>{
      await p.cameraSender.replaceTrack(null);await this.room.configureSender(p);if(p.sent)await this.room.signal(p,{kind:'camera',active:false});
    }));
  }
}
