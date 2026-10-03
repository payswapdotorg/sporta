---
dataset_info:
  features:
  - name: video
    dtype: string
  - name: query
    dtype: string
  - name: response
    dtype: string
  - name: events
    list: string
  - name: path
    dtype: string
  splits:
  - name: train
    num_bytes: 36851411
    num_examples: 85220
  - name: validation
    num_bytes: 1473983
    num_examples: 4625
  download_size: 8639412
  dataset_size: 38325394
configs:
- config_name: default
  data_files:
  - split: train
    path: data/train-*
  - split: validation
    path: data/validation-*
task_categories:
- video-classification
- video-text-to-text
language:
- en
tags:
- synthetic
pretty_name: SoccerChat
license: other
license_link: https://huggingface.co/datasets/SimulaMet/SoccerChat/blob/main/LICENSE
gated: true
extra_gated_heading: SoccerNet NDA Required for Video Access
extra_gated_description: 'This dataset contains short video clips (≤10 seconds) derived
  from SoccerNet broadcast footage. Access to the video content requires signing the
  official SoccerNet NDA. By requesting access, you confirm compliance with the SoccerNet
  NDA terms.

  '
extra_gated_button_content: Request Access (NDA Required)
extra_gated_prompt: 'Annotations and metadata in SoccerChat are released under MIT
  licence.

  But, the `video` field is NOT MIT licensed and may not be redistributed, publicly
  hosted, reconstructed, or used for commercial purposes.

  Access to `video` field requires a valid and active SoccerNet NDA. The NDA can be
  signed at: https://www.soccer-net.org/data#:~:text=NDA

  As annotations and metadata remain derived from SoccerNet content, they must not
  be used to reconstruct, redistribute, or commercially exploit the original videos.

  '
extra_gated_fields:
  I confirm that I have a valid, active SoccerNet NDA: checkbox
---




# ⚽ SoccerChat Dataset

**Official Dataset** for 📄 [SoccerChat: Integrating Multimodal Data for Enhanced Soccer Game Understanding](https://arxiv.org/abs/2505.16630). This dataset supports multimodal research on soccer video understanding, especially in tasks involving natural language reasoning and event detection.

[![Model on HF](https://img.shields.io/badge/HuggingFace-Model-yellow)](https://huggingface.co/SimulaMet/SoccerChat-qwen2-vl-7b)
[![Github Project Homepage](https://img.shields.io/badge/GitHub-HomePage-orange)](https://github.com/simula/SoccerChat/)
[![arXiv](https://img.shields.io/badge/arXiv-2505.16630-b31b1b.svg)](https://arxiv.org/abs/2505.16630)
[![Web UI Demo – Colab](https://img.shields.io/badge/Web%20UI%20Demo-Colab-ffa500?logo=googlecolab&logoColor=white)](https://colab.research.google.com/github/Simula/SoccerChat/blob/main/notebooks/WebUI.ipynb)

## 📁 Dataset Structure

The dataset is split into two partitions:
- `train` (85,220 examples)
- `validation` (4,625 examples)

Each entry includes:
- `video`: previewable video clip 
- `query`: natural language question
- `response`: natural language answer
- `events`: list of one or more SoccerNet event types (can be empty if unannotated)
- `path`: relative path inside the `videos/` directory of repo

---

## 📥 Download Videos

Make sure [git-lfs](https://git-lfs.com) is installed:

```bash
git lfs install
git clone https://huggingface.co/datasets/SimulaMet/SoccerChat
```

> Videos will be available under `SoccerChat/videos/` (~48 GB)


## 🔄 Convert to JSONL (e.g., for MS-SWIFT)

```python
import os, json
from datasets import load_dataset
import pandas as pd

base = "/content/SoccerChat/videos" # path to `videos/` of cloned git repo
ds = load_dataset("SimulaMet/SoccerChat")

for split, out_file in [("train", "SoccerChat+XFoul_train.jsonl"), ("validation", "XFoul_valid.jsonl")]:
    df = ds[split].to_pandas()
    df["query"] = "<video>" + df["query"]
    df["videos"] = df["path"].apply(lambda p: [os.path.join(base, os.path.basename(p))])
    df[["query", "response", "videos"]].to_json(out_file, orient="xrecords", lines=True)
```

## 🧠 Training & Evaluation

You can train and validate using [MS-Swift](https://github.com/modelscope/ms-swift) with a video-language model such as `Qwen2-VL-7B-Instruct`.
> Ensure `SoccerChat+XFoul_train.jsonl` and `XFoul_valid.jsonl` were generated using the JSONL conversion instructions above.

### 🔧 Training 
Example config with 4xA100 GPUs:

```bash
NFRAMES=24 MAX_PIXELS=100352 NPROC_PER_NODE=4 swift sft \
  --model_type qwen2-vl-7b-instruct \
  --model_id_or_path qwen/Qwen2-VL-7B-Instruct \
  --sft_type lora \
  --dataset SoccerChat+XFoul_train.jsonl \
  --num_train_epochs 5 \
  --batch_size 14 \
  --deepspeed default-zero2 \
  --eval_steps 100 \
  --dataset_test_ratio 0.05
```

### 📊 Evaluation
Assuming checkpoint-dir is the directory produced from the training above.

```bash
NFRAMES=24 MAX_PIXELS=100352 swift infer \
  --ckpt_dir checkpoint-dir \
  --load_dataset_config true \
  --merge_lora true \
  --val_dataset XFoul_valid.jsonl
```
## 📬 Contact

For questions, suggestions, or issues regarding the dataset, feel free to reach out to [**Sushant Gautam** ](https://sushant.info.np/) at 📧 sushant@simula.no.

## License & Access

Non-video artifacts (annotations and metadata) are released under the MIT License.

This dataset contains short video clips (≤10s) derived from SoccerNet broadcast footage, along with associated annotations.

See https://huggingface.co/datasets/SimulaMet/SoccerChat/blob/main/LICENSE

Access to the video content requires signing the official SoccerNet NDA:  https://www.soccer-net.org/data#:~:text=NDA

The video clips are **not** MIT licensed and remain subject to the SoccerNet NDA. Redistribution or commercial use is not permitted.


## 📄 Citation

If you use this dataset, please cite:

```bibtex
@article{Gautam2025May,
  author = {Gautam, Sushant and Midoglu, Cise and Thambawita, Vajira and Riegler, Michael A. and Halvorsen, P{\aa}l and Shah, Mubarak},
  title = {{SoccerChat: Integrating Multimodal Data for Enhanced Soccer Game Understanding}},
  journal = {arXiv},
  year = {2025},
  month = may,
  eprint = {2505.16630},
  doi = {10.48550/arXiv.2505.16630}
}
```

