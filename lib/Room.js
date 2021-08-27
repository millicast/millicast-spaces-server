import { uuid } from "uuidv4"

class Room
{
	constructor(name, ownerId, audioOnly)
	{
		this.id = uuid()
		this.name = name;
		this.ownerId = ownerId;
		this.audioOnly = audioOnly;
		this.participants = new Map();
		this.speakers = new Set();
	}

	toJson()
	{
		return {
			id: this.id,
			name: this.name,
			ownerId: this.ownerId,
			audioOnly: this.audioOnly,
			participants: Array.from(this.participants.values()),
			speakers: Array.from(this.speakers.values())
		}
	}

	addParticipant(user)
	{
		this.participants.set(user.id, {
			id: user.id,
			username: user.username
		});
	}

	addSpeaker(userId)
	{
		//Check participant
		const participant = this.participants.get(userId);
		if (!participant)
			throw new Error("participant does not exist in room")
		//If already speaking
		if (this.speakers.has(userId))
			throw new Error("participant is already speaking")
		//Add not muted speaker
		this.speakers.add(userId);
		participant.muted = false;
		participant.raisedHand = false;
	}

	muteSpeaker(userId, muted)
	{
		//Check participant
		const participant = this.participants.get(userId);
		if (!participant)
			throw new Error("participant does not exist in room")
		//If not a speaker
		if (!this.speakers.has(userId))
			throw new Error("participant is not a speaker")
		//Set flag
		participant.muted = muted;
	}

	removeSpeaker(userId)
	{
		//Check participant
		const participant = this.participants.get(userId);
		if (!participant)
			throw new Error("participant does not exist in room")
		if (!this.speakers.delete(userId))
			throw new Error("participant is not a speaker")
		participant.muted = false;
		participant.raisedHand = false;
	}

	removeParticipant(userId)
	{
		this.speakers.delete(userId);
		return this.participants.delete(userId);
	}

	raiseHand(userId, raised)
	{
		//Check participant
		const participant = this.participants.get(userId);
		if (!participant)
			throw new Error("participant does not exist in room")

		//If already speaking
		if (this.speakers.has(userId))
			return false;

		//If not changed
		if (participant.raisedHand == raised)
			return false;

		//Change status
		participant.raisedHand = raised;

		return participant;
	}

	promoteParticipant(userId, promoted)
	{
		//Check participant
		const participant = this.participants.get(userId);
		if (!participant)
			throw new Error("participant does not exist in room")

		//remove raised hand anyway
		participant.raisedHand = false;

		//Check we are not promoting an speaker, demoting a non skeaper
		if (promoted) 
		{
			if (this.speakers.has(userId))
				return false;
			//Add as speaker
			this.speakers.add(userId);
		} else
		{
			if (!this.speakers.has(userId))
				return false;
			//Add as speaker
			this.speakers.delete(userId);
		}

		return participant;
	}

	empty() 
	{
		return this.participants.size == 0;
	}
}

export { Room };