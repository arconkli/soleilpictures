import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwnWorkspace, titleNamesOwner, workspaceTitle, workspaceTileName, workspaceOwnerLine, sharedGroupHead } from './sharedPeopleWords.js';

const unnamed = { name: 'Personal Workspace' };
const named = { name: ' Dune ' };

test('isOwnWorkspace', () => {
  assert.equal(isOwnWorkspace({ _myRole: 'owner' }, null), true);
  assert.equal(isOwnWorkspace({ created_by: 'me' }, 'me'), true);
  assert.equal(isOwnWorkspace({ created_by: 'x' }, 'me'), false);
  assert.equal(!!isOwnWorkspace({ created_by: undefined }, undefined), false);
});

test('titleNamesOwner', () => {
  assert.equal(titleNamesOwner(unnamed, { ownerName: 'Sam', isOwn: false }), true);
  assert.equal(titleNamesOwner(unnamed, { ownerName: 'Sam', isOwn: true }), false);
  assert.equal(titleNamesOwner(unnamed, { ownerName: ' ', isOwn: false }), false);
  assert.equal(titleNamesOwner(named, { ownerName: 'Sam', isOwn: false }), false);
  assert.equal(titleNamesOwner({ name: '' }, { ownerName: 'Sam', isOwn: false }), true);
});

test('workspaceTitle', () => {
  assert.equal(workspaceTitle(unnamed, { ownerName: 'Sam Lee' }), "Sam Lee's workspace");
  assert.equal(workspaceTitle(unnamed, { ownerName: 'Sam', isOwn: true }), 'Personal Workspace');
  assert.equal(workspaceTitle(unnamed), 'Personal Workspace');
  assert.equal(workspaceTitle(named, { ownerName: 'Sam' }), 'Dune');
  assert.equal(workspaceTitle({ name: '  ' }), 'Workspace');
  assert.equal(workspaceTitle(null), 'Workspace');
});

test('workspaceTileName', () => {
  assert.equal(workspaceTileName({ name: 'Personal Workspace' }, { ownerName: ' Sam Lee ' }), 'Sam Lee');
  assert.equal(workspaceTileName({ name: 'Midnight Diner' }, { ownerName: 'Maya' }), 'Midnight Diner');
  assert.equal(workspaceTileName({ name: 'Personal Workspace' }, { ownerName: 'Sam', isOwn: true }), 'Personal Workspace');
  assert.equal(workspaceTileName({ name: '  ' }), 'Workspace');
});

test('workspaceOwnerLine', () => {
  assert.equal(workspaceOwnerLine(unnamed, { ownerName: 'Sam', isOwn: true }), null);
  assert.equal(workspaceOwnerLine(unnamed, { ownerName: 'Sam' }), 'Shared with you');
  assert.equal(workspaceOwnerLine(unnamed, { ownerName: 'Sam', role: 'coowner' }), 'Shared with you · you co-own it');
  assert.equal(workspaceOwnerLine(named, { ownerName: 'Sam' }), 'Owned by Sam');
  assert.equal(workspaceOwnerLine(named, { ownerName: 'Sam', role: 'coowner' }), 'Owned by Sam · you co-own it');
  assert.equal(workspaceOwnerLine(named, {}), 'Shared with you');
  assert.equal(workspaceOwnerLine(named, { role: 'coowner' }), 'You co-own this');
});

test('sharedGroupHead', () => {
  assert.equal(sharedGroupHead({ personName: 'Sam Lee', workspaceName: 'Studio' }), 'From Sam Lee');
  assert.equal(sharedGroupHead({ personName: null, workspaceName: 'Studio' }), 'From Studio');
  assert.equal(sharedGroupHead({ personName: '  ', workspaceName: 'Studio' }), 'From Studio');
});
