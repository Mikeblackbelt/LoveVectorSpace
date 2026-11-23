# Scale definitions

Each `*.yaml` file defines one scale (see `../schema.py`).

## Published scales are structure-only

Published questionnaires (`csi16`, `ecr_r`) are stored with `item_text: local_overlay`
and **no item wording**. The repository is public, so only structure is committed: item ids,
response ranges, reverse keys, subscales, cut-offs, source and terms. `display_text()` shows a
placeholder ("<Scale> item <n> (enter text from the official form)") until you add the text locally.

### Adding the item text locally (never commit it)

1. Create `data/scale_items/<scale_id>.yaml` (the `data/` directory is git-ignored).
2. Make it a mapping from item id to the item text copied from the official form, for example
   `csi16_01: "<text from the official form>"`.
3. The loader (`load_scales(dir, overlay_dir=Path("data/scale_items"))`) merges it into the items.
   An id that is not in the scale definition is an error.

Do not commit overlay files or paste published item text anywhere in the repository.

## Custom scales

`joel_predictors`, `reciprocity`, `disclosure_balance`, `breadcrumbing` and `cdaq_items` use
original wording written for this app, motivated by the cited papers; they are not the published
items. They are `custom: true, owner_approved: false` (draft status) and carry no bands or cut-offs.

## Omitted scales

- `ims_commitment` and `prqc`: their item text appears only in copyrighted articles.
- `ppr` (perceived partner responsiveness): the open measure page only offers a scanned PDF, so
  item count, range and scoring could not be confirmed from an open source.
