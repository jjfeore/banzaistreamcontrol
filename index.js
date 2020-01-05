const player = require('play-sound')(opts = {player: 'mpg123'});
const tmi = require('tmi.js');
const dotenv = require('dotenv');
const huejay = require('huejay');
const tplink = require('tplink-smarthome-api');
const wemo = require('wemo-client');
const WebSocket = require('ws');

dotenv.config();

const hueColor = {
	deeppurple: 49316,
	lightpurple: 56228,
	red: 65535,
	blue: 46920,
	green: 25500,
	orange: 9992
};

let ws;

// Source: https://www.thepolyglotdeveloper.com/2015/03/create-a-random-nonce-string-using-javascript/
function nonce(length) {
    let text = "";
    let possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function wsHeartbeat() {
    message = {
        type: 'PING'
    };
    console.log('WebSocket PING Sent');
    ws.send(JSON.stringify(message));
}

function wsListen(topic) {
    message = {
        type: 'LISTEN',
        nonce: nonce(15),
        data: {
            topics: [topic],
            auth_token: process.env.TWITCH_APP_OAUTH
        }
	};
	let stringified = JSON.stringify(message);
    console.log('Websocket Sent: ' + stringified);
    ws.send(stringified);
}

function wsConnect() {
    let heartbeatInterval = 60000;
    let reconnectInterval = 3000;
    let heartbeatHandle;

    ws = new WebSocket('wss://pubsub-edge.twitch.tv');

    ws.on('open', function() {
        console.log('WebSocket Opened');
        wsHeartbeat();
		heartbeatHandle = setInterval(wsHeartbeat, heartbeatInterval);
		wsListen(`channel-points-channel-v1.${process.env.TWITCH_CHANNEL_ID}`);
    });

    ws.on('error', function(error) {
        console.log('Websocket Error: ' + error);
    });

    ws.on('message', function(data) {
        message = JSON.parse(data);
        console.log('WebSocket Received: ' + data);
        if (message.type == 'RECONNECT') {
            console.log('WebSocket Reconnecting...');
            setTimeout(connect, reconnectInterval);
		}
		else if (message.type == 'reward-redeemed') {
			redeemReward(message.data);
		}
    });

    ws.on('close', function(code, reason) {
        console.log('WebSocket Closed: ' + reason);
        clearInterval(heartbeatHandle);
        console.log('WebSocket Reconnecting...');
        setTimeout(connect, reconnectInterval);
    });
}

wsConnect();

// Connect to the Philips Hue bridge
const hueClient = new huejay.Client({
	host:     '192.168.1.3',
	username: 'CEnnQq8TDPSVcl8SbpptgSnD4aKAdVuooPjlElEF'
});

// Uncomment and run the following method to get the IDs of all connected lights
// hueClient.lights.getAll()
//   .then(lights => {
//     for (let light of lights) {
//       console.log(`Light [${light.id}]: ${light.name}`);
//     }
//   });

// Connect to the Wemo Mini Smart Plug
const wemoClient = new wemo();
let wemoConnection;

wemoClient.load('http://192.168.1.21:49153/setup.xml', function(err, deviceInfo) {
  console.log('Wemo PLUG FOUND');
  wemoConnection = wemoClient.client(deviceInfo);

  wemoConnection.on('error', function(err) {
    console.log('WEMO PLUG ERROR: %s', err.code);
  });

  wemoConnection.on('binaryState', function(value) {
    console.log('WEMO PLUG: Binary State changed to: %s', value);
  });
});


// Connect to TP-Link Wifi Power Strip (HS300) and save the plugs
const tplinkClient = new tplink.Client();
let childPlugs = [null, null, null, null, null, null];

(async () => {
	const device = await tplinkClient.getDevice({ host: '192.168.1.20' });
  
	if (!device.children) {
	  console.log('TP LINK PLUG: Device has no children');
	  return;
	} else {
		console.log(`TP LINK PLUG: Detected device with ${device.children.keys().length} children`);
	}
  
	await Promise.all(Array.from(device.children.keys(), async (childId) => {
	  let childPlug = await tplinkClient.getDevice({ host: '192.168.1.20', childId });
	  let index = childId.charAt(childId.length - 1);
	  childPlugs[parseInt(index)] = childPlug;
	  console.log(`TP LINK PLUG: Plug with ID ${childId} stored at index ${index}`)
	}));
})();

// Connect to Twitch chat
const tmiClient = new tmi.Client({
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

tmiClient.connect();

// Pulse the specified light for 15 seconds, then turn it off
function strobeLight(lightID, color, timeout, stop = true) {
	hueClient.lights.getById(lightID)
		.then(light => {
			console.log('Hue: ' + light.hue);
			console.log(`HUE LIGHT: Strobing light ${light.id} with hue of ${color}`);
			light.on = true;
			light.brightness = 254;
			light.hue = color;
			light.alert = 'lselect'

			return hueClient.lights.save(light);
		})
		.then(light => {
			// If the timeout is over 15000, then renew the strobing at 15 sec intervals
			if (timeout >= 16000) {
				let intervals = 1;
				for (let timeRemaining = timeout - 15000; timeRemaining >= 1000; timeRemaining -= 15000) {
					let nextTimeout = timeRemaining > 15000 ? 15000 : timeRemaining;
					setTimeout(function() {strobeLight(lightID, color, nextTimeout, false);}, 15000 * intervals);
					intervals++;
				}
			}
			if (stop)
				setTimeout(function() {stopLight(lightID);}, timeout);
		})
		.catch(error => {
			console.log('HUE LIGHT: Error modifying light state');
			console.log(error.stack);
		});
}

// Pulses two lights in an alternating pattern
// Ex. alternateStrobing(3, 8, hueColor.red, hueColor.blue, 15000);
function alternateStrobing(light1, light2, color1, color2, timeout) {
	console.log('HUE LIGHT: Alternate strobing');
	strobeLight(light1, color1, timeout);
	setTimeout(function() {strobeLight(light2, color2, timeout);}, 500);
}

// Turn off the specified light
function stopLight(lightID) {
	hueClient.lights.getById(lightID)
		.then(light => {
			console.log(`HUE LIGHT: Turning off light ${light.id}`);
			light.alert = 'none';
			light.on = false;
			return hueClient.lights.save(light);
		})
		.catch(error => {
			console.log('HUE LIGHT: Error modifying light state');
			console.log(error.stack);
		});
}

// Toggle the power switches for a given duration
// wemoState: The state to set the wemo plugs to
// tpState: The state to set the given TP Link plugs to
// tpPlugs: An array of the plug indices for the TP Link power strip
// timeout: The duration to wait before toggling the switches back
function changePowerSwitches(wemoState, tpState, tpPlugs, timeout) {
	if (!wemoState) {
		wemoConnection.setBinaryState(wemoState);
	}
	for (let plug of tpPlugs) {
		childPlugs[plug].setPowerState(tpState).then((powerState, err) => {
			console.log(`Child plug set to power state ${powerState}`);
		});
	}

	// If a timeout is given, toggle the switches back after the timeout expires
	if (timeout > 0) {
		setTimeout(function() {
			// changePowerSwitches(1, tpState ? 0 : 1, tpPlugs, 0);
			if (!wemoState) {
				wemoConnection.setBinaryState(1);
			}
			flipState = tpState ? 0 : 1;
			for (let plug of tpPlugs) {
				childPlugs[plug].setPowerState(flipState).then((powerState, err) => {
					console.log(`Child plug set to power state ${powerState}`);
				});
			}
		}, timeout);
	}
}

let welcomedUsers = new Set();
let noticedUsers = new Set();
let isPaused = false;

// Chat message or whisper
tmiClient.on("chat", (channel, userstate, message, self) => {
	let isMod = (userstate['mod'] || userstate['username'] == 'banzaibaby') ? true : false;
	let isSub = userstate['subscriber'] ? userstate['subscriber'] : false;
	let isVip = userstate['badges-raw'] ? userstate['badges-raw'].includes('vip') : false;

	// Create a set with all the emotes in the mssage
	let emotes = userstate['emotes'] ? Object.keys(userstate['emotes']) : [];
	let emoteSet = new Set(emotes);

	message = message.toLowerCase();
	// console.log(`User is ${userstate['username']} with type ${userstate['user-type']} and isMod ${isMod}`);

	// Allow mods to toggle safemode on or off
	if (isMod && message.startsWith("!safemode")) {
		let words = message.split(' ');
		if (words[1] == 'on') {
			console.log('SAFE MODE ON');
			isPaused = true;
		}
		else if (words[1] == 'off') {
			console.log('SAFE MODE OFF');
			isPaused = false;
		}
	}

	// Allow mods to trigger a demo
	if (isMod && message.startsWith("!demo") && !isPaused) {
		changePowerSwitches(0, 1, [0, 1, 2, 3, 4, 5], 10000);
		
		alternateStrobing(3, 8, hueColor.deeppurple, hueColor.orange, 10000);
		alternateStrobing(9, 10, hueColor.deeppurple, hueColor.orange, 10000);
		
		player.play('./sounds/soundofdapolice.mp3', function(err){
			if (err) throw err
		});
	}

	// If a Mod/Sub/VIP says HeyGuys for the first time that day or anyone uses bzbHey
	if ((((isMod || isSub || isVip) && emoteSet.has('30259')) || emoteSet.has('emotesv2_ec3052867f44421896453a73728dfdb6')) && !isPaused && !welcomedUsers.has(userstate['username'])) {
		changePowerSwitches(1, 1, [2, 3, 4], 3000);
		
		alternateStrobing(3, 8, hueColor.deeppurple, hueColor.orange, 3000);
		alternateStrobing(9, 10, hueColor.deeppurple, hueColor.orange, 3000);
		
		player.play('./sounds/hello.mp3', function(err){
			if (err) throw err
		});
		welcomedUsers.add(userstate['username']);
	}

	// If someone uses bzbNoticeMe
	if (emoteSet.has('emotesv2_461c6588d71e43c6b95dea6052d15701') && !isPaused && !noticedUsers.has(userstate['username'])) {
		changePowerSwitches(1, 1, [2, 3, 4, 5], 6000);
		
		alternateStrobing(3, 8, hueColor.deeppurple, hueColor.orange, 6000);
		alternateStrobing(9, 10, hueColor.deeppurple, hueColor.orange, 6000);
		
		player.play('./sounds/noticemesenpai.mp3', function(err){
			if (err) throw err
		});
		noticedUsers.add(userstate['username']);
	}
});

// User has been banned
tmiClient.on("ban", (channel, username, reason, userstate) => {
	if (!isPaused) {
		player.play('./sounds/soundofdapolice.mp3', function(err){
			if (err) throw err
		});
		
		alternateStrobing(3, 8, hueColor.red, hueColor.blue, 8000);
		alternateStrobing(9, 10, hueColor.red, hueColor.blue, 8000);
		changePowerSwitches(0, 1, [0, 1], 8000);
	}
});

// User has been timed out
tmiClient.on("timeout", (channel, username, reason, duration, userstate) => {
    if (duration >= 300 && !isPaused) {
		player.play('./sounds/soundofdapolice.mp3', function(err){
			if (err) throw err
		});
		
		alternateStrobing(3, 8, hueColor.red, hueColor.blue, 8000);
		alternateStrobing(9, 10, hueColor.red, hueColor.blue, 8000);
		changePowerSwitches(0, 1, [0, 1], 8000);
	}
});

// Channel has been raided
tmiClient.on("raided", (channel, username, viewers) => {
	if (viewers >= 5 && !isPaused) {
		player.play('./sounds/redalert.mp3', function(err){
			if (err) throw err
		});
		
		alternateStrobing(3, 8, hueColor.red, hueColor.orange, 21000);
		alternateStrobing(9, 10, hueColor.red, hueColor.orange, 21000);
		changePowerSwitches(0, 1, [0, 2], 21000);
	}
});

// Sub bomb triggered
tmiClient.on("submysterygift", (channel, username, numbOfSubs, methods, userstate) => {
    if (numbOfSubs >= 5 && !isPaused) {
		player.play('./sounds/boom.mp3', function(err){
			if (err) throw err
		});
		
		alternateStrobing(3, 8, hueColor.deeppurple, hueColor.orange, 26000);
		alternateStrobing(9, 10, hueColor.deeppurple, hueColor.orange, 26000);
		changePowerSwitches(0, 1, [0, 1, 2, 3, 4, 5], 26000);
	}
});

function redeemReward(data) {

}