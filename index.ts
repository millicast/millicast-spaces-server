import { Server } from 'socket.io'
import * as Config from 'config'
import { uuid } from 'uuidv4'
import * as fetch from 'node-fetch'

class LoginModel {
    user: string
    appToken: string
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

const users = {}
let rooms: RoomModel[] = []

const GenerateAppToken = () => {
    return uuid();
}

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
        origin: ['*']
    }
})

const kickUser = (user: LoginModel) => {

    user.pendingRequest = false;
    user.publisherToken = null;
    user.viewerToken = null;

    for (const room of rooms) {

        room.members = room.members.filter(f => f.appToken != user.appToken);
        room.speakers = room.speakers.filter(f => f.appToken != user.appToken);

        if (room.members.length == 0 && room.speakers.length == 0) {
            deleteRoom(room);
        }

        orderRoomUsers(room);

        io.emit('rooms-form', room);
        io.emit('room-requests-modal', room);

    }

    io.emit('rooms-list', rooms);

}

const deleteRoom = (room: RoomModel) => {

    rooms = rooms.filter(f => f.Id != room.Id)

    io.emit('rooms-list', rooms);

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

io
  .of(namespace)
  .on('connection', (socket) => {
    let userAuthenticated: LoginModel = null

    socket.on('authenticate', (username: string, cb) => {

        try {

            if (username == null) cb(ResultModel.WithError('Missing username'))
            if (users[username] != null) cb(ResultModel.WithError('Username already registered'))

            const newUser = new LoginModel()
            newUser.user = username
            newUser.appToken = GenerateAppToken()

            userAuthenticated = newUser
            users[username] = newUser

            cb(ResultModel.WithContent(newUser))

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('disconnect', () => {

        if (userAuthenticated != null) {

            kickUser(userAuthenticated);
            delete users[userAuthenticated.user];

        }

    })

    socket.on('get-rooms', (cb) => {

        try {

            cb(ResultModel.WithContent(rooms));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('get-room-by-id', (roomId: string, cb) => {

        try {

            if (!userAuthenticated) cb(ResultModel.WithError('Not authenticated'))

            const roomResult = rooms.filter(f => f.Id == roomId)[0];

            cb(ResultModel.WithContent(roomResult));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('get-room-user', async (roomId: string, cb) => {

        if (!userAuthenticated) cb(ResultModel.WithError('Not authenticated'))
        const selectedRoom = rooms.filter(f => f.Id == roomId)[0];

        if(userAuthenticated.publisherToken == null && userAuthenticated.appToken == selectedRoom.OwnerId) {
            userAuthenticated.publisherToken = await GeneratePublisherToken(roomId);
        }
        if(userAuthenticated.viewerToken == null) {
            userAuthenticated.viewerToken = await GenerateViewerToken(roomId);
        }

        cb(ResultModel.WithContent(userAuthenticated));

    })

    socket.on('create-room', (roomName: string, onlySound: boolean, cb) => {

        try {

            if (!userAuthenticated) cb(ResultModel.WithError('Not authenticated'))

            const room = new RoomModel()
            room.members = []
            room.speakers = [userAuthenticated]
            room.Id = GenerateAppToken()
            room.OwnerId = userAuthenticated.appToken
            room.name = roomName
            room.onlySound = onlySound
            rooms.push(room)

            cb(ResultModel.WithContent(room))

            io.emit('rooms-list', rooms);

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('exit-rooms', (cb) => {

        try {

            if (!userAuthenticated) cb(ResultModel.WithError('Not authenticated'))

            kickUser(userAuthenticated);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('join-room', (roomId: string, cb) => {

        try {

            if (!userAuthenticated) cb(ResultModel.WithError('Not authenticated'))

            const selectedRoom = rooms.filter(f => f.Id == roomId)[0];

            if (selectedRoom.OwnerId == userAuthenticated.appToken) {
                selectedRoom.speakers.push(userAuthenticated);
            } else {
                selectedRoom.members.push(userAuthenticated);
            }

            orderRoomUsers(selectedRoom);

            io.emit('rooms-list', rooms);
            io.emit('rooms-form', selectedRoom);
            io.emit('room-requests-modal', selectedRoom);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('made-request', (roomId: string, cancel: boolean, cb) => {

        try {

            if (!userAuthenticated) cb(ResultModel.WithError('Not authenticated'))

            const selectedRoom = rooms.filter(f => f.Id == roomId)[0];
            const selectedUser = selectedRoom.members.filter(f => f.appToken == userAuthenticated.appToken)[0] || selectedRoom.speakers.filter(f => f.appToken == userAuthenticated.appToken)[0];

            selectedUser.pendingRequest = cancel;

            io.emit('room-requests-list', selectedRoom);
            io.emit('room-requests-modal', selectedRoom);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

    socket.on('manage-request', async (roomId: string, usrId: string, promote: boolean, cb) => {

        try {

            if (!userAuthenticated) cb(ResultModel.WithError('Not authenticated'))

            const selectedRoom = rooms.filter(f => f.Id == roomId)[0];
            const selectedUser = selectedRoom.members.filter(f => f.appToken == usrId)[0] || selectedRoom.speakers.filter(f => f.appToken == usrId)[0];

            selectedUser.pendingRequest = false;

            selectedRoom.members = selectedRoom.members.filter(f => f.appToken != selectedUser.appToken);
            selectedRoom.speakers = selectedRoom.speakers.filter(f => f.appToken != selectedUser.appToken);

            if (promote) {

                const publisherToken = await GeneratePublisherToken(roomId);

                userAuthenticated.publisherToken = publisherToken;
                selectedUser.publisherToken = publisherToken;

                selectedRoom.speakers.push(selectedUser);

            } else {

                userAuthenticated.publisherToken = null;
                selectedUser.publisherToken = null;

                selectedRoom.members.push(selectedUser);

            }

            orderRoomUsers(selectedRoom);

            io.emit('rooms-form', selectedRoom);
            io.emit('room-requests-modal', selectedRoom);

            cb(ResultModel.WithContent(null));

        } catch (ex) {
            cb(ResultModel.WithError(ex.message))
        }

    })

})
