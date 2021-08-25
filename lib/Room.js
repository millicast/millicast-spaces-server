import { uuid } from "uuidv4"

class Room
{
	constructor(name, ownerId, audioOnly)
	{
		this.id = uuid()
		this.name = name;
		this.ownerId = ownerId;
		this.audioOnly = audioOnly;
		this.participants = new HasMap;
		this.speakers	  = new Set();
	}

	toJson()
	{
		return {
			id		: this.id,
			ownerId		: this.ownerId,
			participants	: this.participants.values(),
			speakers	: this.participants.speakers.values()
		}
	}

	addParticipant(user)
	{
		this.participants.set(user.id, {
			id	 : user.id,
			username : user.username
		});
	}
	addSpeaker(user)
	{
		speakers.add(user.id);
	}

	removeSpeaker(user)
	{
		this.speakers.remove(user.id);
	}

	removeParticipant(user)
	{
		removeSpeaker(user);
		return this.participants.delete(user.id);
	}

	raiseHand(user, raised)
	{
		//Check participant
		const participant = this.participants.get(user.id);
		if (!participant)
			return false;

		//If already speaking
		if (this.speakers.has(user.id))
			return false;
		
		//If not changed
		if (participant.raisedHand==raised)
			return false;
		
		//Change status
		participant.raisedHand = raised;

		return participant;
	}

	promoteParticipant(userId, promoted)
	{
		//Check participant
		const participant = this.participants.get(user.id);
		if (!participant)
			return false;

		//Check we are not promoting an speaker, demoting a non skeaper
		if (promoted) 
		{
			if (this.speakers.has(user.id))
				return false;
			//Add as speaker
			this.speakers.add(user.id);
		} else {
			if (!this.speakers.has(user.id))
				return false;
			//Add as speaker
			this.speakers.delete(user.id);
		}

		//remove raised hand anyway
		participant.raisedHand = false;

		return participant;
	}

	empty() 
	{
		return this.participants.length;
	}
}

export {Room};