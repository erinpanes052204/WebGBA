/* WebGBA core glue: exposes mGBA (MPL-2.0) to JavaScript via WebAssembly.
 * Loading a game builds a complete new session first and only then replaces the running one, so a failed
 * load can never take down the game you are playing. Every allocation is checked. */
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

#include <mgba/core/core.h>
#include <mgba/core/blip_buf.h>
#include <mgba/core/cheats.h>
#include <mgba/core/log.h>
#include <mgba/gba/core.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/savedata.h>
#include <mgba-util/vfs.h>

#define VID_W 240
#define VID_H 160
#define SAVE_CAP 0x20000
#define SAMPLE_RATE 48000
#define AUDIO_CAP 8192

typedef struct {
	struct mCore* core;
	uint32_t* video;
	uint8_t* romCopy;
	uint8_t* saveBuf;
} Session;

static Session cur;
static uint8_t* biosCopy = NULL;
static size_t biosSize = 0;
static uint8_t* pendingSave = NULL;
static size_t pendingSaveSize = 0;
static int16_t audio[AUDIO_CAP * 2];
static int audioCount = 0;
static uint8_t* stateBuf = NULL;
static size_t stateLen = 0;

static void silentLog(struct mLogger* l, int category, enum mLogLevel level, const char* fmt, va_list args) {
	(void) l; (void) category; (void) level; (void) fmt; (void) args;
}
static struct mLogger silentLogger = { .log = silentLog, .filter = NULL };

static void destroy(Session* s) {
	if (s->core) {
		s->core->deinit(s->core);
	}
	free(s->romCopy);
	free(s->saveBuf);
	free(s->video);
	memset(s, 0, sizeof(*s));
}

EMSCRIPTEN_KEEPALIVE void* wg_alloc(size_t n) { return malloc(n ? n : 1); }   /* JS must check for 0 */
EMSCRIPTEN_KEEPALIVE void wg_free(void* p) { free(p); }

EMSCRIPTEN_KEEPALIVE int wg_set_bios(const uint8_t* data, size_t size) {
	free(biosCopy); biosCopy = NULL; biosSize = 0;
	if (data && size) {
		biosCopy = malloc(size);
		if (!biosCopy) return 0;
		memcpy(biosCopy, data, size);
		biosSize = size;
	}
	return 1;
}

EMSCRIPTEN_KEEPALIVE int wg_set_pending_save(const uint8_t* data, size_t size) {
	free(pendingSave); pendingSave = NULL; pendingSaveSize = 0;
	if (data && size) {
		size_t n = size > SAVE_CAP ? SAVE_CAP : size;
		pendingSave = malloc(n);
		if (!pendingSave) return 0;
		memcpy(pendingSave, data, n);
		pendingSaveSize = n;
	}
	return 1;
}

EMSCRIPTEN_KEEPALIVE int wg_load_rom(const uint8_t* data, size_t size) {
	if (!data || size < 0xC0) return 0;
	Session next;
	memset(&next, 0, sizeof(next));
	next.romCopy = malloc(size);
	if (!next.romCopy) return 0;
	memcpy(next.romCopy, data, size);

	mLogSetDefaultLogger(&silentLogger);
	struct mCore* c = GBACoreCreate();
	if (!c) { free(next.romCopy); return 0; }
	mCoreInitConfig(c, NULL);
	if (!c->init(c)) { mCoreConfigDeinit(&c->config); free(c); free(next.romCopy); return 0; }
	next.core = c;

	next.video = calloc(VID_W * VID_H, sizeof(uint32_t));
	if (!next.video) { destroy(&next); return 0; }
	c->setVideoBuffer(c, (color_t*) next.video, VID_W);
	c->setAudioBufferSize(c, 2048);
	blip_set_rates(c->getAudioChannel(c, 0), c->frequency(c), SAMPLE_RATE);
	blip_set_rates(c->getAudioChannel(c, 1), c->frequency(c), SAMPLE_RATE);

	struct VFile* rom = VFileFromMemory(next.romCopy, size);
	if (!rom) { destroy(&next); return 0; }
	if (!c->loadROM(c, rom)) { rom->close(rom); destroy(&next); return 0; }
	if (biosCopy) {
		struct VFile* bios = VFileFromMemory(biosCopy, biosSize);
		if (bios && !c->loadBIOS(c, bios, 0)) bios->close(bios);
	}
	next.saveBuf = malloc(SAVE_CAP);
	if (!next.saveBuf) { destroy(&next); return 0; }
	memset(next.saveBuf, 0xFF, SAVE_CAP);
	if (pendingSave) memcpy(next.saveBuf, pendingSave, pendingSaveSize);
	struct VFile* sav = VFileFromMemory(next.saveBuf, SAVE_CAP);
	if (!sav) { destroy(&next); return 0; }
	c->loadSave(c, sav);
	c->reset(c);

	destroy(&cur);          /* only now is the old game torn down */
	cur = next;
	return 1;
}

EMSCRIPTEN_KEEPALIVE void wg_reset(void) { if (cur.core) cur.core->reset(cur.core); }
EMSCRIPTEN_KEEPALIVE void wg_set_keys(uint32_t keys) { if (cur.core) cur.core->setKeys(cur.core, keys); }

EMSCRIPTEN_KEEPALIVE void wg_run_frame(void) {
	if (!cur.core) return;
	cur.core->runFrame(cur.core);
	for (int i = 0; i < VID_W * VID_H; ++i) cur.video[i] |= 0xFF000000u;
	blip_t* l = cur.core->getAudioChannel(cur.core, 0);
	blip_t* r = cur.core->getAudioChannel(cur.core, 1);
	int n = blip_read_samples(l, audio, AUDIO_CAP, 1);
	blip_read_samples(r, audio + 1, AUDIO_CAP, 1);
	audioCount = n;
}

EMSCRIPTEN_KEEPALIVE uint32_t* wg_video_ptr(void) { return cur.video; }
EMSCRIPTEN_KEEPALIVE int16_t* wg_audio_ptr(void) { return audio; }
EMSCRIPTEN_KEEPALIVE int wg_audio_count(void) { return audioCount; }
EMSCRIPTEN_KEEPALIVE int wg_sample_rate(void) { return SAMPLE_RATE; }
EMSCRIPTEN_KEEPALIVE uint8_t* wg_save_ptr(void) { return cur.saveBuf; }

EMSCRIPTEN_KEEPALIVE int wg_save_size(void) {
	if (!cur.core) return 0;
	return (int) GBASavedataSize(&((struct GBA*) cur.core->board)->memory.savedata);
}

EMSCRIPTEN_KEEPALIVE void wg_title(char* out) {
	if (cur.core) cur.core->getGameTitle(cur.core, out); else out[0] = 0;
}

EMSCRIPTEN_KEEPALIVE int wg_state_save(void) {
	if (!cur.core) return 0;
	size_t n = cur.core->stateSize(cur.core);
	free(stateBuf);
	stateBuf = calloc(1, n);
	if (!stateBuf) { stateLen = 0; return 0; }
	stateLen = n;
	if (!cur.core->saveState(cur.core, stateBuf)) return 0;
	return (int) stateLen;
}
EMSCRIPTEN_KEEPALIVE uint8_t* wg_state_ptr(void) { return stateBuf; }

EMSCRIPTEN_KEEPALIVE int wg_state_load(const uint8_t* data, size_t size) {
	if (!cur.core || !data || size != cur.core->stateSize(cur.core)) return 0;
	void* tmp = malloc(size);
	if (!tmp) return 0;
	memcpy(tmp, data, size);
	int ok = cur.core->loadState(cur.core, tmp) ? 1 : 0;
	free(tmp);
	return ok;
}

static struct mCheatSet* cheatSet(void) {
	struct mCheatDevice* dev = cur.core->cheatDevice(cur.core);
	if (mCheatSetsSize(&dev->cheats)) {
		return *mCheatSetsGetPointer(&dev->cheats, 0);
	}
	struct mCheatSet* set = dev->createSet(dev, NULL);
	if (!set) return NULL;
	mCheatAddSet(dev, set);
	return set;
}
EMSCRIPTEN_KEEPALIVE int wg_cheat_add(const char* line) {
	if (!cur.core || !line) return 0;
	struct mCheatSet* set = cheatSet();
	return set && mCheatAddLine(set, line, 0) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE void wg_cheat_clear(void) {
	if (cur.core) mCheatDeviceClear(cur.core->cheatDevice(cur.core));
}
