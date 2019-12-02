const ks = require('node-key-sender');
const player = require('play-sound')(opts = {});
const tmi = require('tmi.js');
const dotenv = require('dotenv');

dotenv.config();
const client = new tmi.Client({
	options: { debug: true },
	connection: {
		reconnect: true,
		secure: true
	},
	identity: {
		username: process.env.TWITCH_USER,
		password: process.env.TWITCH_OAUTH
	},
	channels: [ process.env.TWITCH_CHANNEL ]
});

client.connect();

// Blue light
const plug1 = ['control', 'shift', 'a'];
// Red light
const plug2 = ['control', 'shift', 'b'];
// Disco light
const plug3 = ['control', 'shift', 'p'];

// Chat message or whisper
client.on("message", (channel, userstate, message, self) => {
    if (self) return;

	let msgType = userstate['message-type'];
	let isMod = userstate['user-type'] == 'mod';

	if (msgType == 'chat' && isMod) {
		console.log(message);
		ks.sendCombination(plug1);
		setTimeout(function(){ ks.sendCombination(plug1); }, 8000);
		
		player.play('toilet.mp3', function(err){
			if (err) throw err
		});
	}
});

// User has been banned
client.on("ban", (channel, username, reason, userstate) => {
    // Do your stuff.
});

// User has been timed out
client.on("timeout", (channel, username, reason, duration, userstate) => {
    // Do your stuff.
});