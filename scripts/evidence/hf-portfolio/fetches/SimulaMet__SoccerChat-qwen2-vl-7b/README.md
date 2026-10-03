---
base_model: Qwen/Qwen2-VL-7B-Instruct
library_name: peft
license: apache-2.0
tags:
- video
- multimodal
- soccer
datasets:
- SimulaMet/SoccerChat
language:
- en
pipeline_tag: video-text-to-text
---

# SoccerChat-qwen2-vl-7b ⚽📊  
**A Multimodal Vision-Language Model for Soccer Game Understanding**

[![Paper](https://img.shields.io/badge/Arxiv-2505.16630v1-red)](https://arxiv.org/abs/2505.16630v1)
[![GitHub](https://img.shields.io/badge/Code-GitHub-black)](https://github.com/simula/SoccerChat)
[![Dataset](https://img.shields.io/badge/Dataset-SoccerChat-blue)](https://huggingface.co/datasets/SimulaMet/SoccerChat)
[![Web UI Demo – Colab](https://img.shields.io/badge/Web%20UI%20Demo-Colab-ffa500?logo=googlecolab&logoColor=white)](https://colab.research.google.com/github/Simula/SoccerChat/blob/main/notebooks/WebUI.ipynb)

---

## Model Details

### Model Description
**SoccerChat-qwen2-vl-7b** is a **LoRA-finetuned version of Qwen2-VL-7B-Instruct** designed for **soccer video understanding and dialogue**.  
It is trained on the [SoccerChat dataset](https://huggingface.co/datasets/SimulaMet/SoccerChat), introduced in the paper *[SoccerChat: Integrating Multimodal Data for Enhanced Soccer Game Understanding](https://arxiv.org/abs/2505.16630)*.  

The model integrates **video frames, event annotations, and commentary text** to support **question answering, commentary generation, and event-based reasoning** in soccer.

- **Developed by:** SimulaMet (Simula Metropolitan Center for Digital Engineering, Norway)  
- **Model type:** Vision-Language Model (VLM) finetuned with PEFT/LoRA  
- **Primary language:** English (soccer-domain specific)  
- **License:** Apache 2.0  
- **Base model:** [qwen/Qwen2-VL-7B-Instruct](https://huggingface.co/qwen/Qwen2-VL-7B-Instruct)  

---

## How to Get Started with the Model
Use the code below to get started with the model.
The model accepts **video + text queries**.  
[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/Simula/SoccerChat/blob/main/notebooks/usage.ipynb)

```python
import os
import torch
from swift.llm import PtEngine, RequestConfig, InferRequest
from transformers import  BitsAndBytesConfig

# quantized for free T4 in Colab; paper reports performance on unquantized model.
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",         # best accuracy for 4-bit
    bnb_4bit_use_double_quant=True,    # better compression
    bnb_4bit_compute_dtype=torch.float16
)
os.environ["FPS_MIN_FRAMES"]="24"
os.environ["FPS_MAX_FRAMES"]="24"
os.environ["VIDEO_MAX_PIXELS"]="100352"

engine = PtEngine(adapters=[ "SimulaMet/SoccerChat-qwen2-vl-7b"], quantization_config = bnb_config, attn_impl="sdpa", max_batch_size=1, use_hf=True, model_id_or_path="Qwen/Qwen2-VL-7B-Instruct", )
req_cfg = RequestConfig(max_tokens=512, temperature=0.3, top_k=20, top_p=0.7, repetition_penalty=1.05) 

infer_requests = [
    InferRequest(messages=[{
    "role": "user",
    "content": [
        {"type": "video", "video": "https://huggingface.co/datasets/SimulaMet/SoccerChat/resolve/main/videos/MultipleEvents/100037_Shotsontarget--Balloutofplay.mp4"},
        # {"type": "video","video": "data:video/mp4;base64," + base64.b64encode(open("/localpath/video.mp4", "rb").read()).decode("utf-8")}, # for local path
        {"type": "text", "text": "What is shown in the video?"}
    ],
}])
]
resp = engine.infer(infer_requests, req_cfg)
print(resp[0].choices[0].message.content)
```

---

## Sources
- **GitHub:** [simula/SoccerChat](https://github.com/simula/SoccerChat)  
- **Dataset:** [SimulaMet/SoccerChat](https://huggingface.co/datasets/SimulaMet/SoccerChat)  
- **Paper:** [arXiv:2505.16630](https://arxiv.org/abs/2505.16630)  

---

## Uses

### Direct Use
- Answering **questions about soccer matches** based on video frames and commentary.  
- **Explaining events** such as goals, fouls, substitutions, and passes.  
- Generating **contextual match commentary** aligned with multimodal inputs.  

### Downstream Use
- **Sports analytics platforms** for researchers and practitioners.  
- **Interactive soccer assistants** for fans, broadcasters, and educational tools.  

### Out-of-Scope Use
- General-purpose reasoning beyond soccer.  
- Sensitive domains (medical, legal, safety-critical applications).  
- Gambling or betting predictions.  

---

## Bias, Risks, and Limitations
- The model is trained on **soccer-specific multimodal data** → limited generalization outside this domain.  
- May generate **hallucinated commentary** if video frames are ambiguous.  
- Currently optimized for **English** → other languages are not supported.  

---


## Training Details

### Training Data
- **Dataset:** [SoccerChat](https://huggingface.co/datasets/SimulaMet/SoccerChat)  
- Contains synchronized **video frames, event labels, and commentary text** for soccer matches.  

### Training Procedure
- **Method:** LoRA finetuning with [PEFT](https://github.com/huggingface/peft).  
- **Base model:** Qwen2-VL-7B-Instruct.  
- **Precision:** fp16 mixed.  
- **Implementation:** [Training scripts](https://huggingface.co/datasets/SimulaMet/SoccerChat).  

*(For full hyperparameters and details, see paper.)*  

---

## Evaluation

### Testing Data
- Held-out splits from the SoccerChat dataset.  

### Metrics
- Automatic metrics: BLEU, ROUGE, METEOR (for generated text).  
- Event-based metrics: accuracy/recall for detecting key match events.  
- Human evaluation: commentary fluency and correctness (as reported in the paper).  

### Results
- The paper reports **improved performance over baseline models** in multimodal soccer understanding tasks.  
- See [Table results in the paper](https://arxiv.org/abs/2505.16630) for details.  

---

## Environmental Impact
- Training used **GPU-based compute** (exact hardware and CO2 estimates not specified in paper).  
- Users are encouraged to consult the [MLCO2 Impact Calculator](https://mlco2.github.io/impact#compute) for replication scenarios.  

---

## Citation

If you use this model, please cite:

```bibtex
@article{Gautam2025May,
	author = {Gautam, Sushant and Midoglu, Cise and Thambawita, Vajira and others},
	title = {{SoccerChat: Integrating Multimodal Data for Enhanced Soccer Game Understanding}},
	journal = {ArXiv e-prints},
	year = {2025},
	month = may,
	eprint = {2505.16630},
	doi = {10.48550/arXiv.2505.16630}
}
```

---

## Contact
- **Organization:** SimulaMet  
- **Website:** [simula.no](https://www.simula.no/)  
- **GitHub Issues:** [simula/SoccerChat](https://github.com/simula/SoccerChat/issues)