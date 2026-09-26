from datetime import timedelta
from livekit import api
from .config import config


def room_name(meeting_id):
    return 'sky-' + meeting_id


def token(meeting, participant):
    cfg = config()
    return (api.AccessToken(cfg.livekit_api_key, cfg.livekit_api_secret)
            .with_identity(participant.identity).with_name(participant.name)
            .with_ttl(timedelta(seconds=60))
            .with_grants(api.VideoGrants(room_join=True, room=room_name(meeting.id),
                                       can_publish=True, can_subscribe=True, can_publish_data=True,
                                       can_update_own_metadata=False, room_admin=False))
            .to_jwt())


def client():
    cfg = config()
    return api.LiveKitAPI(cfg.livekit_internal_url, cfg.livekit_api_key, cfg.livekit_api_secret)


async def remove(meeting_id, identity):
    async with client() as lk:
        try:
            await lk.room.remove_participant(api.RoomParticipantIdentity(room=room_name(meeting_id), identity=identity))
        except api.TwirpError as e:
            if e.code != 'not_found':
                raise


async def end(meeting_id):
    async with client() as lk:
        try:
            await lk.room.delete_room(api.DeleteRoomRequest(room=room_name(meeting_id)))
        except api.TwirpError as e:
            if e.code != 'not_found':
                raise


async def mute(meeting_id, identity):
    async with client() as lk:
        person = await lk.room.get_participant(api.RoomParticipantIdentity(room=room_name(meeting_id), identity=identity))
        for track in person.tracks:
            if track.type == api.TrackType.AUDIO:
                await lk.room.mute_published_track(api.MuteRoomTrackRequest(room=room_name(meeting_id), identity=identity, track_sid=track.sid, muted=True))


async def snapshot():
    """Read actual SFU state so cleanup does not depend on a delivered webhook."""
    async with client() as lk:
        rooms = await lk.room.list_rooms(api.ListRoomsRequest())
        result = []
        for room in rooms.rooms:
            if not room.name.startswith('sky-'):
                continue
            try:
                people = await lk.room.list_participants(api.ListParticipantsRequest(room=room.name))
                result.append((room.name.removeprefix('sky-'), [p.identity for p in people.participants]))
            except api.TwirpError as e:
                if e.code != 'not_found':
                    raise
        return result
