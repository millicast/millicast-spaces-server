import * as fetch from 'node-fetch'
import {default as Config} from 'config'

//Millicast api configurations
const endpoint		= Config.get("endpoint");
const accountId		= Config.get("accountId");
const publisherToken	= Config.get("publisherToken");
const viewerToken	= Config.get("viewerToken");

const generatePublisherToken = async (streamName) =>
{
	//Publishing webrtc
	const streamType = "WebRtc";
	//Get a new token
	const response = await fetch(`${endpoint}/api/director/publish`, {
		method: "POST",
		mode: "cors",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${publisherToken}`
		},
		body: JSON.stringify({
			streamName, streamType
		})
	});
	//Parse json
	const body = await response.json();
	//get token
	return body.data;
}

const generateViewerToken = async (streamName) =>
{
	//Get viewer token
	const response = await fetch(`${endpoint}/api/director/subscribe`, {
		method: "POST",
		mode: "cors",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${viewerToken}`
		},
		body: JSON.stringify({
			streamName, accountId
		})
	});
	//Parse json
	const body = await response.json();
	//get token
	return body.data;
}



export { generatePublisherToken, generateViewerToken };