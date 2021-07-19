import { Server } from 'socket.io'
import * as Config from 'config'
import { uuid } from 'uuidv4'
import * as fetch from 'node-fetch'

class LoginModel {
    user: string
    id: string
    publisherToken: any
    viewerToken: any
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
    user.publisherToken = null;
    user.viewerToken = null;

    for (const [roomId,room] of rooms) {

        room.members = room.members.filter(f => f.id != user.id);
        room.speakers = room.speakers.filter(f => f.id != user.id);

        if (room.members.length == 0 && room.speakers.length == 0) {
            deleteRoom(room);
        }

        orderRoomUsers(room);

        ns.emit('rooms-form', room);
        ns.emit('room-requests-modal', room);

    }

    ns.emit('rooms-list', rooms.values());

}

const deleteRoom = (room: RoomModel) => {

    rooms.delete(room.Id)

    ns.emit('rooms-list', rooms.values());

}

const orderRoomUsers = (room: RoomModel) => {

    room.members = orderByUserName(room.members);
    room.speakers = orderByUserName(room.speakers);

}

const orderByUserName = (userList: LoginModel[]) => {

    return userList.sort(function (a, b) {

        if (a.user > b.user) {
            return 1;
        }
        if (a.user < b.user) {
            return -1;
        }

        return 0;
    });

}

const ns = io.of(namespace)

ns.on('connection', (socket) => {
    let user: LoginModel = null

    socket.on('authenticate', (username: string, cb) => {
        try {

            if (username == null) cb(ResultModel.WithError('Missing username'))
            if (users[username] != null) cb(ResultModel.WithError('Username already registered'))

            user = new LoginModel()
            user.user = username
            user.id = socket.id

            users[username] = user;

            cb(ResultModel.WithContent(user))

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('disconnect', () => {

        if (user != null) {

            kickUser(user);
            delete users[user.user];

        }

    })

    socket.on('get-rooms', (cb) => {

        try {

            cb(ResultModel.WithContent(rooms.values()));

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
        const selectedRoom = rooms.get(roomId);
        const requests = [null,null];
        if(user.publisherToken == null && user.id == selectedRoom.OwnerId) {
             requests[0] = GeneratePublisherToken(roomId);
        }
        if(user.viewerToken == null) {
             requests[1] = GenerateViewerToken(roomId);
        }
        const tokens = await Promise.all(requests);
        user.publisherToken = tokens[0];
        user.viewerToken = tokens[1];
        cb(ResultModel.WithContent(user));

    })

    socket.on('create-room', (roomName: string, onlySound: boolean, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            const room = new RoomModel()
            room.members = []
            room.speakers = [user]
            room.Id = uuid()
            room.OwnerId = user.id
            room.name = roomName
            room.onlySound = onlySound
            rooms.set(room.Id,room)

            cb(ResultModel.WithContent(room))

            ns.emit('rooms-list', rooms.values);

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

    socket.on('join-room', (roomId: string, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            const selectedRoom = rooms.get(roomId);

            if (selectedRoom.OwnerId == user.id) {
                selectedRoom.speakers.push(user);
            } else {
                selectedRoom.members.push(user);
            }

            orderRoomUsers(selectedRoom);

            ns.emit('rooms-list', rooms.values());
            ns.emit('rooms-form', selectedRoom);
            ns.emit('room-requests-modal', selectedRoom);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('made-request', (roomId: string, cancel: boolean, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

            const selectedRoom = rooms.get(roomId);
            const selectedUser = selectedRoom.members.filter(f => f.id == user.id)[0] || selectedRoom.speakers.filter(f => f.id == user.id)[0];

            selectedUser.pendingRequest = cancel;

            ns.emit('room-requests-list', selectedRoom);
            ns.emit('room-requests-modal', selectedRoom);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('manage-request', async (roomId: string, usrId: string, promote: boolean, cb) => {

        try {

            if (!user) cb(ResultModel.WithError('Not authenticated'))

           const selectedRoom = rooms.get(roomId);
            const selectedUser = selectedRoom.members.filter(f => f.id == usrId)[0] || selectedRoom.speakers.filter(f => f.id == usrId)[0];

            selectedUser.pendingRequest = false;

            selectedRoom.members = selectedRoom.members.filter(f => f.id != selectedUser.id);
            selectedRoom.speakers = selectedRoom.speakers.filter(f => f.id != selectedUser.id);

            if (promote) {

                const publisherToken = await GeneratePublisherToken(roomId);

                user.publisherToken = publisherToken;
                selectedUser.publisherToken = publisherToken;

                selectedRoom.speakers.push(selectedUser);

            } else {

                user.publisherToken = null;
                selectedUser.publisherToken = null;

                selectedRoom.members.push(selectedUser);

            }

            orderRoomUsers(selectedRoom);

            ns.emit('rooms-form', selectedRoom);
            ns.emit('room-requests-modal', selectedRoom);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

})
