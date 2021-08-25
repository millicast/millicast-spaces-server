import { Server } from "socket.io"
import { default as Config} from 'config'
import { Logger } from "./lib/Logger.js"
import { generatePublisherToken, generateViewerToken } from "./lib/Millicast.js"
import { Room } from "./lib/Room.js"

class Result
{
	static WithContent(content)
	{
		return {
			Error: {
				HasError: false,
				Message: ""
			},
			content
		};
	}
	static WithError(message)
	{
		return {
			Error: {
				HasError: true,
				Message: message
			}
		}
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

const ns = io.of(namespace)

const mainLogger = new Logger("connections");

ns.on("connection", (socket) =>
{
	let user = null
	let logger = connectionsLogger.child(socket.id);

	mainLogger.info("connected");

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
			if (users.has(username) != null)
				return cb(Result.WithError("Username already registered"));

			//Create logger
			logger = mainLogger.child(username);

			//Create user and assing the socket id as identifier
			user = {
				id : socket.id,
				username: username
			};

			//Add user
			users.set(username,user);
			//Done
			cb(Result.WithContent({user,rooms}));

		} catch (ex) {
			logger.error("authenticated as %s", username);
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
			if (room.removeParticipant(user))
				//Send event
				ns.emit("user-left",{roomId:joined.id, userId:user.id});
			//If not participant left
			if (room.empty())
			{
				rooms.delete(room.id)
				ns.emit("room-deleted", {roomId:room.id});
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

			ns.emit("room-created", room.toJson());

			cb(Result.WithContent(room.id))

		} catch (ex) {
			cb(Result.WithError(ex.message))
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

			room.removeParticipant(user);

			cb(Result.WithContent(null));

			//Emit event
			ns.emit("user-left", {
				roomId: joined.id,
				user  : user
			});

			//If not participant left
			if (room.empty())
			{
				rooms.delete(room.id)
				ns.emit("room-deleted", {roomId:room.id});
			}
		} catch (ex) {
			cb(Result.WithError(ex.message))
		}
	})

	socket.on("join-room", async (roomId, cb) =>
	{
		try
		{
			if (!user)  return cb(Result.WithError("Not authenticated"))
			if (joined) return cb(Result.WithError("User already in a room"))

			logger.info("joining room %s", roomId);

			//Get room to join
			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))

			const requests = [generateViewerToken(roomId)];
			if (room.ownerId == user.id)
				requests[1] = generatePublisherToken(roomId);

			const [viewerToken,publisherToken] = await Promise.all(requests);

			const tokens = {viewerToken,publisherToken}

			cb(Result.WithContent({ room, tokens }));

			//Emit event
			ns.emit("user-joined", room.id, user);

			if (room.ownerId == user.id)
				ns.emit("user-promoted",{roomId, userId, promoted});

		} catch (ex) {
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
			io.to(roomId).emit("user-raised-hand",{
				roomId : room.id,
				userId : user.id,
				raised : raised
			});

		} catch (ex) {
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
			
			if (!room.promoteParticipant(userId, promoted))
				 return cb(Result.WithError("Error"))

			//Find client for promoted user
			const socket = clients.get(userId);

			if (promoted)
			{
				logger.info("promoting user:%s in room:%s", usrId, roomId);
				//Get token
				GeneratePublisherToken(roomId).then((publisherToken) => {
					//Tokens
					const tokens = {publisherToken};
					//Emit token only to the promoted user
					socket.emit("promoted", roomId, tokens);
				});
			} else {
				logger.info("demoting user:%s in room:%s", usrId, roomId);
			}

			cb(Result.WithContent(null));

			ns.emit("user-promoted",{roomId, userId, promoted});

		} catch (ex) {
			cb(Result.WithError(ex.message))
		}
	})

	socket.on("kick-user", async (roomId, userId, promoted, cb) =>
	{
		try
		{
			if (!user) cb(Result.WithError("Not authenticated"))

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))
			
			if (!room.removeParticipant(userId, promoted))
				return cb(Result.WithError("Error"))

			//Find client for promoted user
			const socket = clients.get(userId);

			//Emit token only to the kicked user
			socket.emit("kicked", roomId);

			cb(Result.WithContent(null));

			ns.emit("user-left",{roomId, userId});

		} catch (ex) {
			cb(Result.WithError(ex.message))
		}
	})

	socket.on("mute-user", async (roomId, userId, cb) =>
	{
		try
		{
			if (!user) cb(Result.WithError("Not authenticated"))

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))
			
			if (!room.muteSpeaker(userId, true))
				return cb(Result.WithError("Error"))

			//Find client for promoted user
			const socket = clients.get(userId);

			//Emit token only to the kicked user
			socket.emit("muted", roomId);

			cb(Result.WithContent(null));

			io.to(roomId).emit("user-muted",{roomId, userId, muted});

		} catch (ex) {
			cb(Result.WithError(ex.message))
		}
	});

	socket.on("mute", async (roomId, userId, muted, cb) => {
		try
		{
			if (!user) cb(Result.WithError("Not authenticated"))

			const room = rooms.get(roomId);

			if (!room) return cb(Result.WithError("Room does not exist"))
			
			if (!room.muteSpeaker(userId, muted))
				return cb(Result.WithError("Error"))

			cb(Result.WithContent(null));

			io.to(roomId).emit("user-muted",{roomId, userId, muted});

		} catch (ex) {
			cb(Result.WithError(ex.message))
		}
	});
})
