import { Server } from 'socket.io'
import * as Config from 'config'
import { uuid } from 'uuidv4'
import * as fetch from 'node-fetch'
import { Logger } from "./lib/Logger"

class TokenModel {
    publisherToken: any
    viewerToken: any
}

class LoginModel {
    user: string
    id: string
    pendingRequest: boolean
}


class RoomModel {
    Id: string
    OwnerId: string
    name: string
    onlySound: boolean
    speakers: LoginModel[]
    members: LoginModel[]
}
class JoinModel
{
    tokens:TokenModel
    room:RoomModel
}

class ErrorModel {
    HasError: boolean
    Message: string
}

class ResultModel<T> {
    Error: ErrorModel
    content: T
    public static WithContent<T>(obj: T): ResultModel<T> {
        const result = new ResultModel<T>()
        result.Error = {
            HasError: false,
            Message: ''
        }
        result.content = obj
        return result
    }
    public static WithError(message: string): ResultModel<void> {
        const result = new ResultModel<void>()
        result.Error = {
            HasError: true,
            Message: message
        }
        return result
    }
}


//Millicast api configurations
const endpoint = Config.get("endpoint");
const accountId = Config.get("accountId");
const publisherToken = Config.get("publisherToken");
const viewerToken = Config.get("viewerToken");

//Socket.io configuration
const port = Config.get("socket-io.port");
const path = Config.get("socket-io.path");
const namespace = Config.get("socket-io.namespace");

const clients = new Map<string,any>();
const users = new Map<string,LoginModel>();
const rooms = new Map<string,RoomModel>();

const GeneratePublisherToken = async (streamName) => {

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

const GenerateViewerToken = async (streamName) => {

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

const io = new Server(port, {
    path: path,
    cors: {
        origin: ['http://localhost:8100', 'https://millicast.fontventa.com']
    }
})

const kickUser = (user: LoginModel) => {

    user.pendingRequest = false;

    for (const [roomId,room] of rooms) {

        room.members = room.members.filter(f => f.id != user.id);
        room.speakers = room.speakers.filter(f => f.id != user.id);

        if (room.members.length == 0 && room.speakers.length == 0) {
            deleteRoom(room);
        }

        ns.emit('rooms-form', room);
        ns.emit('room-requests-modal', room);

    }

    ns.emit('rooms-list', Array.from(rooms.values()));

}

const deleteRoom = (room: RoomModel) => {

    rooms.delete(room.Id)

    ns.emit('rooms-list', Array.from(rooms.values()));

}

const ns = io.of(namespace)

const connectionsLogger = new Logger("connections");

ns.on('connection', (socket) => {
    let user: LoginModel = null
    const logger = connectionsLogger.child(socket.id);
    logger.info("connected");
    
    clients.set(socket.id,socket);

    socket.on('authenticate', (username: string, cb) => {
        try {

            logger.info("authenticated as %s",username);
            //Check username was provided
            if (username == null) {
                logger.info("Missing username");
                cb(ResultModel.WithError('Missing username'));
            }
            //Check not duplicated username
            if (users[username] != null) {
                logger.info("Username already registered");
                cb(ResultModel.WithError('Username already registered'));
            }

            //Create user model and assing the socket id as identifier
            user = new LoginModel();
            user.user = username;
            user.id = socket.id;

            //Add user
            users[username] = user;

            cb(ResultModel.WithContent(user));

        } catch (ex) {
            logger.error("authenticated as %s",username);
            cb(ResultModel.WithError(ex.message));
        }

    })

    socket.on('disconnect', () => {

        if (user != null) {
            logger.info("disconnected");
            kickUser(user);
            delete users[user.user];
            clients.delete(socket.id);

        }

    })

    socket.on('get-rooms', (cb) => {

        try {
            cb(ResultModel.WithContent(Array.from(rooms.values())));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('get-room-by-id', (roomId: string, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            const roomResult = rooms.get(roomId);

            cb(ResultModel.WithContent(roomResult));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('get-room-user', async (roomId: string, cb) => {

        if (!user) cb(ResultModel.WithError('Not authenticated'))
        const room = rooms.get(roomId);
       
        cb(ResultModel.WithContent(user));

    })

    socket.on('create-room', (roomName: string, onlySound: boolean, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            const room = new RoomModel()
            room.members = []
            room.speakers = []
            room.Id = uuid()
            room.OwnerId = user.id
            room.name = roomName
            room.onlySound = onlySound

            logger.info("creating room %s with id:%s",roomName,room.Id);

            rooms.set(room.Id,room)

            cb(ResultModel.WithContent(room))
            ns.emit('rooms-list', Array.from(Array.from(rooms.values())));
            
        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('exit-rooms', (cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            kickUser(user);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('join-room', async (roomId: string, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            logger.info("joining room %s",roomId);

            const room = rooms.get(roomId);
            const requests = [GenerateViewerToken(roomId)];
            if (room.OwnerId == user.id) {
                room.speakers.push(user);
                requests[1] = GeneratePublisherToken(roomId);
            } else {
                room.members.push(user);
            }

            ns.emit('rooms-list', Array.from(rooms.values()));
            ns.emit('rooms-form', room);
            ns.emit('room-requests-modal', room);

            const response = await Promise.all(requests);

            const tokens = new TokenModel();
            tokens.viewerToken = response[0];
            tokens.publisherToken = response[1];
            
            cb(ResultModel.WithContent({room,tokens}));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('made-request', (roomId: string, cancel: boolean, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            const room = rooms.get(roomId);
            const selectedUser = room.members.filter(f => f.id == user.id)[0] || room.speakers.filter(f => f.id == user.id)[0];

            selectedUser.pendingRequest = cancel;

            ns.emit('room-requests-list', room);
            ns.emit('room-requests-modal', room);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('manage-request', async (roomId: string, usrId: string, promote: boolean, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            const room = rooms.get(roomId);
            const selectedUser = room.members.filter(f => f.id == usrId)[0] || room.speakers.filter(f => f.id == usrId)[0];

            selectedUser.pendingRequest = false;

            //Find client for promoted user
            const socket = clients.get(usrId);

            room.members = room.members.filter(f => f.id != selectedUser.id);
            room.speakers = room.speakers.filter(f => f.id != selectedUser.id);

            if (promote) {
                logger.info("promoting user:%s in room:%s",usrId,roomId);
                //add to speakers
                room.speakers.push(selectedUser);
                //Get token
                GeneratePublisherToken(roomId).then((token) => {
                    const tokens = new TokenModel();
                    tokens.publisherToken = token;
                    //Emit token only to the promoted user
                    socket.emit("user-promoted",roomId,tokens);
                });

            } else {
                //Emit token only to the promoted user
                socket.emit("user-demoted",roomId);
                //Add to audience
                room.members.push(selectedUser);
            }

            ns.emit('rooms-form', room);
            ns.emit('room-requests-modal', room);
            ns.emit('rooms-list', Array.from(Array.from(rooms.values())));

            cb(ResultModel.WithContent(null));


        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

})
