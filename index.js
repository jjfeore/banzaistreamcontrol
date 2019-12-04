const ks = require('node-key-sender');
const player = require('play-sound')(opts = {player: 'mpg123'});
const tmi = require('tmi.js');
const dotenv = require('dotenv');
const huejay = require('huejay');
const tplink = require('tplink-smarthome-api');
const wemo = require('wemo-client');

dotenv.config();

const hueColor = {
	deeppurple: 49316,
	lightpurple: 56228,
	red: 65535,
	blue: 46920,
	green: 25500,
	orange: 9992
};

// Define key press values for the PowerUSB power strip
const plug1 = ['control', 'shift', 'a'];
const plug2 = ['control', 'shift', 'b'];
const plug3 = ['control', 'shift', 'p'];

// Connect to the Philips Hue bridge
const hueClient = new huejay.Client({
	host:     '192.168.1.2',
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
  console.log('Wemo PLUG FOUND: %j', deviceInfo);
  wemoConnection = wemoClient.client(deviceInfo);

  wemoConnection.on('error', function(err) {
    console.log('WEMO PLUG ERROR: %s', err.code);
  });

  wemoConnection.on('binaryState', function(value) {
    console.log('WEMO PLUG: Binary State changed to: %s', value);
  });

  // Turn the switch on in case it isn't already on
  wemoConnection.setBinaryState(1);
});


// Connect to TP-Link Wifi Power Strip (HS300) and save the plugs
const tplinkClient = new tplink.Client();
let childPlugs = [];

(async () => {
	const device = await tplinkClient.getDevice({ host: '192.168.1.20' });
  
	console.log(device.alias);
  
	if (!device.children) {
	  console.log('TP LINK PLUG: Device has no children');
	  return;
	} else {
		console.log(`TP LINK PLUG: Detected device with ${device.children.length + 1} children`);
	}
  
	await Promise.all(Array.from(device.children.keys(), async (childId) => {
	  let childPlug = await tplinkClient.getDevice({ host: '192.168.1.20', childId });
	  childPlugs.push(childPlug);
	  console.log(`TP LINK PLUG: Plug with ID ${childId} ready`)
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
function strobeLight(lightID, color) {
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
			setTimeout(function() {stopLight(lightID);}, 15000);
		})
		.catch(error => {
			console.log('HUE LIGHT: Error modifying light state');
			console.log(error.stack);
		});
}

// Pulses two lights in an alternating pattern
// Ex. alternateStrobing(3, 8, hueColor.red, hueColor.blue);
function alternateStrobing(light1, light2, color1, color2) {
	console.log('HUE LIGHT: Alternate strobing');
	strobeLight(light1, color1);
	setTimeout(function() {strobeLight(light2, color2);}, 500);
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

// Chat message or whisper
tmiClient.on("message", (channel, userstate, message, self) => {
    if (self) return;

	let msgType = userstate['message-type'];
	let isMod = userstate['user-type'] == 'mod';

	if (msgType == 'chat' && isMod) {
		console.log(message);
		// wemoConnection.setBinaryState(1);
		childPlugs[0].setPowerState(0).then((powerState, err) => {
			console.log(`Child plug set to power state ${powerState}`);
		});
		
		player.play('toilet.mp3', function(err){
			if (err) throw err
		});
	}
});

// User has been banned
tmiClient.on("ban", (channel, username, reason, userstate) => {
    // Do your stuff.
});

// User has been timed out
tmiClient.on("timeout", (channel, username, reason, duration, userstate) => {
    // Do your stuff.
});