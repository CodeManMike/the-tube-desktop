import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBlockMenuItem, parseBlockEntry, removeBlocked } from '../plugins/channelBlocklist';

const RICK = 'UCuAXFkgsw1L7xaCfnd5JJOw';
const at = (pathname: string) => ((globalThis as any).location = { pathname, hostname: 'www.youtube.com' });
const sheet = (items: any[]) => ({ menuButton: { buttonViewModel: { onTap: { innertubeCommand: { showSheetCommand: { panelLoadingStrategy: { inlineContent: { sheetViewModel: { content: { listViewModel: { listItems: items } } } } } } } } } } });
const dontRecommend = { listItemViewModel: { title: { content: "Don't recommend channel" }, leadingImage: { sources: [{ clientResource: { imageName: 'REMOVE' } }] }, rendererContext: { commandContext: { onTap: { innertubeCommand: { feedbackEndpoint: {} } } } } } };
const lockup = (id: string, channel: string, handle: string, items: any[] = [dontRecommend]) => ({ richItemRenderer: { content: { lockupViewModel: {
  contentId: id,
  metadata: { lockupMetadataViewModel: {
    image: { decoratedAvatarViewModel: { rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: channel, canonicalBaseUrl: '/' + handle } } } } } } },
    metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Rick Astley' } }] }] } },
    ...sheet(items),
  } },
} } } });
const feed = (...items: any[]) => ({ contents: items });
const ids = (d: any) => d.contents.map((x: any) => x.richItemRenderer?.content.lockupViewModel.contentId ?? Object.keys(x)[0]);

test('parseBlockEntry reads names with ids, handles and bare ids, and rejects junk', () => {
  assert.deepEqual(parseBlockEntry(`Rick Astley (${RICK})`), { id: RICK });
  assert.deepEqual(parseBlockEntry('@RickAstleyYT'), { handle: '@rickastleyyt' });
  assert.deepEqual(parseBlockEntry(RICK), { id: RICK });
  assert.equal(parseBlockEntry('just words'), null);
  assert.equal(parseBlockEntry(''), null);
});

test('items from a blocked channel are removed (by id and by handle, case-insensitive)', () => {
  at('/');
  const data = feed(lockup('a', RICK, '@RickAstleyYT'), lockup('b', 'UC' + 'x'.repeat(22), '@other'));
  assert.deepEqual(ids(removeBlocked(structuredClone(data), { channels: [`Rick (${RICK})`] })), ['b']);
  assert.deepEqual(ids(removeBlocked(structuredClone(data), { channels: ['@rickastleyyt'] })), ['b']);
});

test('removal keeps continuation items', () => {
  at('/');
  assert.deepEqual(ids(removeBlocked(feed(lockup('a', RICK, '@r'), { continuationItemRenderer: {} }), { channels: [RICK] })), ['continuationItemRenderer']);
});

test("the blocked channel's own page is untouched", () => {
  at('/@RickAstleyYT');
  assert.deepEqual(ids(removeBlocked(feed(lockup('a', RICK, '@RickAstleyYT')), { channels: [RICK] })), ['a']);
});

test("a lockup menu gains Block channel after Don't recommend channel", () => {
  const out = addBlockMenuItem(feed(lockup('a', RICK, '@RickAstleyYT')), {});
  const items = out.contents[0].richItemRenderer.content.lockupViewModel.metadata.lockupMetadataViewModel.menuButton.buttonViewModel.onTap.innertubeCommand.showSheetCommand.panelLoadingStrategy.inlineContent.sheetViewModel.content.listViewModel.listItems;
  assert.equal(items.length, 2);
  assert.equal(items[1].listItemViewModel.title.content, 'Block channel');
  const cmd = items[1].listItemViewModel.rendererContext.commandContext.onTap.innertubeCommand;
  assert.equal(cmd.urlEndpoint.url, `https://www.youtube.com/ttd/block-channel?c=${RICK}&h=%40RickAstleyYT&n=Rick%20Astley`);
  assert.equal(items[0].listItemViewModel.title.content, "Don't recommend channel"); // original untouched
});

test("a menu without Don't recommend channel is unchanged", () => {
  const other = { listItemViewModel: { title: { content: 'Add to queue' } } };
  const out = addBlockMenuItem(feed(lockup('a', RICK, '@r', [other])), {});
  assert.equal(out.contents[0].richItemRenderer.content.lockupViewModel.metadata.lockupMetadataViewModel.menuButton.buttonViewModel.onTap.innertubeCommand.showSheetCommand.panelLoadingStrategy.inlineContent.sheetViewModel.content.listViewModel.listItems.length, 1);
});

test('a browse response for a channel page is untouched while the URL still shows Home', () => {
  at('/');
  assert.deepEqual(ids(removeBlocked(feed(lockup('a', RICK, '@r')), { channels: [RICK] }, { endpoint: 'browse', browseId: RICK })), ['a']);
});

test('a Home response is filtered while the URL still shows a channel page', () => {
  at('/@someone');
  assert.deepEqual(ids(removeBlocked(feed(lockup('a', RICK, '@r')), { channels: [RICK] }, { endpoint: 'browse', browseId: 'FEwhat_to_watch' })), []);
});

test('the id in the trailing brackets wins over an id-shaped name', () => {
  const fake = 'UC' + 'f'.repeat(22);
  assert.deepEqual(parseBlockEntry(`${fake} (${RICK})`), { id: RICK });
});
