import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DescriptionMarkdown,
  prepareEditorialMarkdown,
} from './description-markdown';

test('renders standard GFM markdown tables as semantic HTML tables', () => {
  const md = [
    'To maximize score velocity, revision schedules must reflect modern thematic weightage across official test papers:',
    '',
    '| Core Agribusiness Domain | Question Share | Primary PYQ Focus Area |',
    '| :--- | :---: | ---: |',
    '| Agricultural Marketing & Supply Chain | 26-30% | e-NAM logistics, post-harvest losses, APMC dynamics |',
    '| Farm Management & Agri-Economics | 22-25% | Production function stages, farm budgeting, marginal costs |',
  ].join('\n');

  const html = renderToStaticMarkup(
    <DescriptionMarkdown
      markdown={md}
      heroTitle="Agribusiness Management CUET PG Mock Tests"
    />
  );

  assert.match(html, /<table\b/);
  assert.match(html, /<thead\b/);
  assert.match(html, /<tbody\b/);
  assert.match(html, /<th[^>]*scope="col"[^>]*>Core Agribusiness Domain<\/th>/);
  assert.match(html, /<th[^>]*text-center[^>]*>Question Share<\/th>/);
  assert.match(html, /<th[^>]*text-end[^>]*>Primary PYQ Focus Area<\/th>/);
  assert.match(html, /<td[^>]*>26-30%<\/td>/);
  assert.doesNotMatch(html, /\| :--- \|/);
});

test('expands flattened single-line GFM tables and separates tables attached directly after prose', () => {
  const flattened =
    'Coverage overview:\n| Domain | Weight |\n| :--- | :--- |\n| Marketing | 30% |';
  const prepared = prepareEditorialMarkdown(flattened, 'Test Book');
  assert.match(prepared, /Coverage overview:\n\n\| Domain \| Weight \|/);

  const singleLine =
    '| Domain | Weight | | :--- | ---: | | Marketing | 30% | | Policy | 20% |';
  const html = renderToStaticMarkup(
    <DescriptionMarkdown markdown={singleLine} heroTitle="Test Book" />
  );
  assert.match(html, /<table\b/);
  assert.match(html, /<td[^>]*>Marketing<\/td>/);
  assert.match(html, /<td[^>]*text-end[^>]*>20%<\/td>/);
});
