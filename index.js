import { Server } from "socket.io"
import { default as Config} from 'config'
import { Logger } from "./lib/Logger.js"
import { generatePublisherToken, generateViewerToken } from "./lib/Millicast.js"
import { Room } from "./lib/Room.js"

class Result
{
	static WithContent(data)
	{
		return {data};
	}
	static WithError(error)
	{
		return {error}
	}
}

//Socket.io configuration
const port		= Config.get("socket-io.port");
const path		= Config.get("socket-io.path");
const namespace		= Config.get("socket-io.namespace");

//Maps
const clients	= new Map();
const users	= new Map();
const rooms	= new Map();

const io = new Server(port, {
	path: path,
	cors: {
		origin: ["*"]
	}
})

const ns = io.of(namespace);
const spaces = ns.to("spaces");

const mainLogger = new Logger("spaces");

ns.on("connection", (socket) =>
{
	let user = null
	let logger = null;

	//Add client to map
	clients.set(socket.id, socket);

	socket.on("authenticate", (username, cb) =>
	{
		try
		{
			//Check username was provided
			if (username == null)
				return cb(Result.WithError("Missing username"));
			//Check not duplicated username
			if (users.has(username))
				return cb(Result.WithError("Username already registered"));

			//Create logger
			logger = mainLogger.child(username);

			logger.info("authenticated");

			//Create user and assing the socket id as identifier
			user = {
				id : socket.id,
				username: username
			};

			//Add user
			users.set(username,user);
			//Join to default room
			socket.join("spaces");
			//Done
			cb(Result.WithContent({user,rooms: Array.from(rooms.values()).map(r=>r.toJson())}));

		} catch (ex) {
			logger.error(ex);
			cb(Result.WithError(ex.message));
		}
	})

	socket.on("disconnect", () =>
	{
		//If not logged in
		if (!user)
			//Done
			return;

		logger.info("disconnected");

		//For each room
		//TODO: optimize
		for (const room of rooms.values())
		{
			//Try removing participant from room
			if (room.removeParticipant(user.id))
				//Send event
				spaces.emit("user-left", room.id, user.id);
			//If not participant left
			if (room.empty())
			{
				rooms.delete(room.id)
				spaces.emit("room-deleted", room.id);
				mainLogger.info("Room deleted %s", room.id);
			}
		}

		users.delete(user.username);
		clients.delete(socket.id);
	})

	socket.on("create-room", (roomName, audioOnly, cb) =>
	{
		try
		{
			if (!user) 
				return cb(Result.WithError("Not authenticated"))
			//Create new room
			const room = new Room(roomName,user.id,audioOnly)

			logger.info("creating room %s with id:%s", roomName, room.id);

			rooms.set(room.id, room)

			mainLogger.info("Room created %s", room.id);

			spaces.emit("room-created", room.toJson());

			cb(Result.WithContent(room.id))
			
		} catch (ex) {
			logger.error(ex);
			cb(Result.WithError(ex.message));
		}
	})

	socket.on("leave-room", (roomId, cb) =>
	{
		try
		{
			if (!user) return cb(Result.WithError("Not authenticated"))

			logger.info("exiting room %s", roomId);

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))

			room.removeParticipant(user.id);

			//Remove user from socket.io room
			socket.leave(roomId);

			cb(Result.WithContent(null));

			//Emit event
			spaces.emit("user-left", room.id, user.id);
			//If not participant left
			if (room.empty())
			{
				rooms.delete(room.id)
				spaces.emit("room-deleted", room.id);
				mainLogger.info("Room deleted %s", room.id);
			}
		} catch (ex) {
			logger.error(ex);	
			cb(Result.WithError(ex.message))
		}
	})

	socket.on("join-room", async (roomId, cb) =>
	{
		try
		{
			if (!user)  return cb(Result.WithError("Not authenticated"))

			logger.info("joining room %s", roomId);

			//Get room to join
			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))

			//Add user
			room.addParticipant(user);

			const requests = [generateViewerToken(roomId)];
			if (room.ownerId == user.id)
				requests[1] = generatePublisherToken(roomId);

			const [viewerToken,publisherToken] = await Promise.all(requests);

			const tokens = {viewerToken,publisherToken}

			//Join user to socket.io room
			socket.join(roomId);

			//Emit event
			spaces.emit("user-joined", room.id, user);

			if (room.ownerId == user.id)
			{
				//Add user as speaker too
				room.addSpeaker(user.id);
				spaces.emit("user-promoted", roomId, user.id, true);
			}

			cb(Result.WithContent(tokens));

		} catch (ex) {
			logger.error(ex);
			cb(Result.WithError(ex.message))
		}

	})

	socket.on("raise-hand", (roomId, raised, cb) =>
	{
		try
		{
			if (!user) return cb(Result.WithError("Not authenticated"))

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))

			logger.info("rasing hand room %s", roomId);

			room.raiseHand(user.id, raised);

			cb(Result.WithContent(null));

			//Emit the event to room only
			ns.to(roomId).emit("user-raised-hand", room.id, user.id, raised);

		} catch (ex) {
			logger.error(ex);
			cb(Result.WithError(ex.message))
		}

	})

	socket.on("promote-user", async (roomId, userId, promoted, cb) =>
	{
		try
		{
			if (!user) cb(Result.WithError("Not authenticated"))

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))
			if (room.ownerId!=user.id)  return cb(Result.WithError("You are not the owner of the room"))
			
			if (!room.promoteParticipant(userId, promoted))
			{
				//If we were rejecting a promotion
				if (!promoted)
					//Signal hand lowered to room only
					ns.to(roomId).emit("user-raised-hand", roomId, userId, false);
				return cb(Result.WithContent(null));
			}

			//Find client for promoted user
			const socket = clients.get(userId);

			if (promoted)
			{
				logger.info("promoting user:%s in room:%s", userId, roomId);
				//Get token
				generatePublisherToken(roomId).then((publisherToken) => {
					//Tokens
					const tokens = {publisherToken};
					//Emit token only to the promoted user
					socket.emit("promoted", roomId, tokens);
				});
			} else {
				logger.info("demoting user:%s in room:%s", userId, roomId);
				//Emit token only to the demoted
				socket.emit("demoted", roomId);
			}

			cb(Result.WithContent(null));

			spaces.emit("user-promoted",roomId, userId, promoted);

		} catch (ex) {
			logger.error(ex);
			cb(Result.WithError(ex.message))
		}
	})

	socket.on("kick-user", async (roomId, userId, cb) =>
	{
		try
		{
			if (!user) cb(Result.WithError("Not authenticated"))

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))
			if (room.ownerId!=user.id)  return cb(Result.WithError("You are not the owner of the room"))
			
			room.removeParticipant(userId);

			//Find client for promoted user
			const socket = clients.get(userId);

			//Remove user from socket.io room
			socket.leave(roomId);

			//Emit token only to the kicked user
			socket.emit("kicked", roomId);

			cb(Result.WithContent(null));

			spaces.emit("user-left",roomId, userId);

			//If no participant left
			if (room.empty())
			{
				rooms.delete(room.id)
				spaces.emit("room-deleted", room.id);
				mainLogger.info("Room deleted %s", room.id);
			}

		} catch (ex) {
			logger.error(ex);
			cb(Result.WithError(ex.message))
		}
	})

	socket.on("mute-speaker", async (roomId, userId, cb) =>
	{
		try
		{
			if (!user) cb(Result.WithError("Not authenticated"))

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))
			if (room.ownerId!=user.id)  return cb(Result.WithError("You are not the owner of the room"))
			
			//Mute
			room.muteSpeaker(userId, true);

			//Find client for promoted user
			const socket = clients.get(userId);

			//Emit token only to the kicked user
			socket.emit("muted", roomId);

			cb(Result.WithContent(null));

			ns.to(roomId).emit("user-muted",roomId, userId, true);

		} catch (ex) {
			logger.error(ex);
			cb(Result.WithError(ex.message))
		}
	});

	socket.on("mute", async (roomId, muted, cb) => {
		try
		{
			if (!user) cb(Result.WithError("Not authenticated"))

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))
			
			//Mute
			room.muteSpeaker(user.id, muted);

			cb(Result.WithContent(null));

			ns.to(roomId).emit("user-muted",roomId, user.id, muted);

		} catch (ex) {
			logger.error(ex);
			cb(Result.WithError(ex.message))
		}
	});
})
