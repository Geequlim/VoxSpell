# ASCEND mixed-language test fixtures

This directory contains a quality-screened 20-utterance subset of ASCEND for Mandarin-English code-switching regression tests.

- Source: [CAiRE/ASCEND](https://huggingface.co/datasets/CAiRE/ASCEND)
- Paper: [ASCEND: A Spontaneous Chinese-English Dataset for Code-switching in Multi-turn Conversation](https://arxiv.org/abs/2112.06223)
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Changes: selected mixed-language utterances between 2 and 8 seconds across train, validation, and test; screened for transcript completeness, clipping, silence ratio, and loudness; renamed each audio file to `ascend_<split>_<id>.wav`. Audio content and transcripts are otherwise unchanged.

The subset covers 14 speakers and five topics. Each WAV file has an exact transcript in the adjacent `.wav.txt` file. Original sample metadata and audio quality metrics are preserved in `manifest.json`.
