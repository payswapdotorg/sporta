---
license: apache-2.0
language:
- en
- zh
pipeline_tag: text-to-video
library_name: videox_fun
tags:
- video
- video-generation
- wan2.2
base_model:
- Wan-AI/Wan2.2-I2V-A14B
---

# Wan-Fun

😊 Welcome!

[![Hugging Face Spaces](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Spaces-yellow)](https://huggingface.co/spaces/alibaba-pai/Wan2.1-Fun-1.3B-InP)

[![Github](https://img.shields.io/badge/🎬%20Code-Github-blue)](https://github.com/aigc-apps/VideoX-Fun)

[English](./README_en.md) | [简体中文](./README.md)

# 目录
- [目录](#目录)
- [模型地址](#模型地址)
- [视频作品](#视频作品)
- [快速启动](#快速启动)
- [如何使用](#如何使用)
- [参考文献](#参考文献)
- [许可证](#许可证)

# 模型地址

| 名称 | 存储空间 | Hugging Face | Model Scope | 描述 |
|--|--|--|--|--|
| Wan2.2-Fun-A14B-InP | 64.0 GB | [🤗Link](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-InP) | [😄Link](https://modelscope.cn/models/PAI/Wan2.2-Fun-A14B-InP) | Wan2.2-Fun-14B文图生视频权重，以多分辨率训练，支持首尾图预测。 |
| Wan2.2-Fun-A14B-Control | 64.0 GB | [🤗Link](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control) | [😄Link](https://modelscope.cn/models/PAI/Wan2.2-Fun-A14B-Control)| Wan2.2-Fun-14B视频控制权重，支持不同的控制条件，如Canny、Depth、Pose、MLSD等，同时支持使用轨迹控制。支持多分辨率（512，768，1024）的视频预测，支持多分辨率（512，768，1024）的视频预测，以81帧、每秒16帧进行训练，支持多语言预测 |
| Wan2.2-Fun-A14B-Control-Camera | 64.0 GB | [🤗Link](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera) | [😄Link](https://modelscope.cn/models/PAI/Wan2.2-Fun-A14B-Control-Camera)| Wan2.2-Fun-14B相机镜头控制权重。支持多分辨率（512，768，1024）的视频预测，支持多分辨率（512，768，1024）的视频预测，以81帧、每秒16帧进行训练，支持多语言预测 |

# 视频作品

### Wan2.2-Fun-A14B-InP

<table border="0" style="width: 100%; text-align: left; margin-top: 20px;">
  <tr>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/inp_1.mp4" width="100%" controls autoplay loop></video>
      </td>
       <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/inp_2.mp4" width="100%" controls autoplay loop></video>
     </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/inp_3.mp4" width="100%" controls autoplay loop></video>
      </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/inp_4.mp4" width="100%" controls autoplay loop></video>
     </td>
  </tr>
</table>

<table border="0" style="width: 100%; text-align: left; margin-top: 20px;">
  <tr>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/inp_5.mp4" width="100%" controls autoplay loop></video>
      </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/inp_6.mp4" width="100%" controls autoplay loop></video>
      </td>
       <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/inp_7.mp4" width="100%" controls autoplay loop></video>
     </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/inp_8.mp4" width="100%" controls autoplay loop></video>
     </td>
  </tr>
</table>

### Wan2.2-Fun-A14B-Control

Generic Control Video + Reference Image:
<table border="0" style="width: 100%; text-align: left; margin-top: 20px;">
  <tr>
      <td>
          Reference Image
      </td>
      <td>
          Control Video
      </td>
      <td>
          Wan2.2-Fun-14B-Control
      </td>
  <tr>
      <td>
          <image src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/8.png" width="100%" controls autoplay loop></image>
      </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/pose.mp4" width="100%" controls autoplay loop></video>
      </td>
       <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/14b_ref.mp4" width="100%" controls autoplay loop></video>
     </td>
  <tr>
</table>

Generic Control Video (Canny, Pose, Depth, etc.) and Trajectory Control:
<table border="0" style="width: 100%; text-align: left; margin-top: 20px;">
  <tr>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/guiji.mp4" width="100%" controls autoplay loop></video>
      </td>
       <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/guiji_out.mp4" width="100%" controls autoplay loop></video>
     </td>
  <tr>
</table>

<table border="0" style="width: 100%; text-align: left; margin-top: 20px;">
  <tr>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/pose.mp4" width="100%" controls autoplay loop></video>
      </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/canny.mp4" width="100%" controls autoplay loop></video>
      </td>
       <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/depth.mp4" width="100%" controls autoplay loop></video>
     </td>
  <tr>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/pose_out.mp4" width="100%" controls autoplay loop></video>
      </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/canny_out.mp4" width="100%" controls autoplay loop></video>
      </td>
       <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/depth_out.mp4" width="100%" controls autoplay loop></video>
     </td>
  </tr>
</table>

### Wan2.2-Fun-A14B-Control-Camera

<table border="0" style="width: 100%; text-align: left; margin-top: 20px;">
  <tr>
      <td>
          Pan Up
      </td>
      <td>
          Pan Left
      </td>
       <td>
          Pan Right
     </td>
     <td>
          Zoom In
     </td>
  <tr>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/Pan_Up.mp4" width="100%" controls autoplay loop></video>
      </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/Pan_Left.mp4" width="100%" controls autoplay loop></video>
      </td>
       <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/Pan_Right.mp4" width="100%" controls autoplay loop></video>
     </td>
     <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/Zoom_In.mp4" width="100%" controls autoplay loop></video>
     </td>
  <tr>
      <td>
          Pan Down
      </td>
      <td>
          Pan Up + Pan Left
      </td>
       <td>
          Pan Up + Pan Right
     </td>
       <td>
          Zoom Out
     </td>
  <tr>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/Pan_Down.mp4" width="100%" controls autoplay loop></video>
      </td>
      <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/Pan_UL.mp4" width="100%" controls autoplay loop></video>
      </td>
       <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/Pan_UR.mp4" width="100%" controls autoplay loop></video>
     </td>
     <td>
          <video src="https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/wan_fun/asset_Wan2_2/v1.0/Zoom_Out.mp4" width="100%" controls autoplay loop></video>
     </td>
  </tr>
</table>


# 快速启动
### 1. 云使用: AliyunDSW/Docker
#### a. 通过阿里云 DSW
DSW 有免费 GPU 时间，用户可申请一次，申请后3个月内有效。

阿里云在[Freetier](https://free.aliyun.com/?product=9602825&crowd=enterprise&spm=5176.28055625.J_5831864660.1.e939154aRgha4e&scm=20140722.M_9974135.P_110.MO_1806-ID_9974135-MID_9974135-CID_30683-ST_8512-V_1)提供免费GPU时间，获取并在阿里云PAI-DSW中使用，5分钟内即可启动CogVideoX-Fun。

[![DSW Notebook](https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/easyanimate/asset/dsw.png)](https://gallery.pai-ml.com/#/preview/deepLearning/cv/cogvideox_fun)

#### b. 通过ComfyUI
我们的ComfyUI界面如下，具体查看[ComfyUI README](comfyui/README.md)。
![workflow graph](https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/cogvideox_fun/asset/v1/cogvideoxfunv1_workflow_i2v.jpg)

#### c. 通过docker
使用docker的情况下，请保证机器中已经正确安装显卡驱动与CUDA环境，然后以此执行以下命令：

```
# pull image
docker pull mybigpai-public-registry.cn-beijing.cr.aliyuncs.com/easycv/torch_cuda:cogvideox_fun

# enter image
docker run -it -p 7860:7860 --network host --gpus all --security-opt seccomp:unconfined --shm-size 200g mybigpai-public-registry.cn-beijing.cr.aliyuncs.com/easycv/torch_cuda:cogvideox_fun

# clone code
git clone https://github.com/aigc-apps/VideoX-Fun.git

# enter VideoX-Fun's dir
cd VideoX-Fun

# download weights
mkdir models/Diffusion_Transformer
mkdir models/Personalized_Model

# Please use the hugginface link or modelscope link to download the model.
# CogVideoX-Fun
# https://huggingface.co/alibaba-pai/CogVideoX-Fun-V1.1-5b-InP
# https://modelscope.cn/models/PAI/CogVideoX-Fun-V1.1-5b-InP

# Wan
# https://huggingface.co/alibaba-pai/Wan2.1-Fun-V1.1-14B-InP
# https://modelscope.cn/models/PAI/Wan2.1-Fun-V1.1-14B-InP
# https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-InP
# https://modelscope.cn/models/PAI/Wan2.2-Fun-A14B-InP
```

### 2. 本地安装: 环境检查/下载/安装
#### a. 环境检查
我们已验证该库可在以下环境中执行：

Windows 的详细信息：
- 操作系统 Windows 10
- python: python3.10 & python3.11
- pytorch: torch2.2.0
- CUDA: 11.8 & 12.1
- CUDNN: 8+
- GPU： Nvidia-3060 12G & Nvidia-3090 24G

Linux 的详细信息：
- 操作系统 Ubuntu 20.04, CentOS
- python: python3.10 & python3.11
- pytorch: torch2.2.0
- CUDA: 11.8 & 12.1
- CUDNN: 8+
- GPU：Nvidia-V100 16G & Nvidia-A10 24G & Nvidia-A100 40G & Nvidia-A100 80G

我们需要大约 60GB 的可用磁盘空间，请检查！

#### b. 权重放置
我们最好将[权重](#model-zoo)按照指定路径进行放置：

**通过comfyui**：
将模型放入Comfyui的权重文件夹`ComfyUI/models/Fun_Models/`：
```
📦 ComfyUI/
├── 📂 models/
│   └── 📂 Fun_Models/
│       ├── 📂 CogVideoX-Fun-V1.1-2b-InP/
│       ├── 📂 CogVideoX-Fun-V1.1-5b-InP/
│       ├── 📂 Wan2.1-Fun-V1.1-14B-InP
│       └── 📂 Wan2.1-Fun-V1.1-1.3B-InP/
```

**运行自身的python文件或ui界面**:
```
📦 models/
├── 📂 Diffusion_Transformer/
│   ├── 📂 CogVideoX-Fun-V1.1-2b-InP/
│   ├── 📂 CogVideoX-Fun-V1.1-5b-InP/
│   ├── 📂 Wan2.1-Fun-V1.1-14B-InP
│   └── 📂 Wan2.1-Fun-V1.1-1.3B-InP/
├── 📂 Personalized_Model/
│   └── your trained trainformer model / your trained lora model (for UI load)
```

# 如何使用

<h3 id="video-gen">1. 生成 </h3>

#### a、显存节省方案
由于Wan2.2的参数非常大，我们需要考虑显存节省方案，以节省显存适应消费级显卡。我们给每个预测文件都提供了GPU_memory_mode，可以在model_cpu_offload，model_cpu_offload_and_qfloat8，sequential_cpu_offload中进行选择。该方案同样适用于CogVideoX-Fun的生成。

- model_cpu_offload代表整个模型在使用后会进入cpu，可以节省部分显存。
- model_cpu_offload_and_qfloat8代表整个模型在使用后会进入cpu，并且对transformer模型进行了float8的量化，可以节省更多的显存。
- sequential_cpu_offload代表模型的每一层在使用后会进入cpu，速度较慢，节省大量显存。

qfloat8会部分降低模型的性能，但可以节省更多的显存。如果显存足够，推荐使用model_cpu_offload。

#### b、通过comfyui
具体查看[ComfyUI README](https://github.com/aigc-apps/VideoX-Fun/tree/main/comfyui)。

#### c、运行python文件
- 步骤1：下载对应[权重](#model-zoo)放入models文件夹。
- 步骤2：根据不同的权重与预测目标使用不同的文件进行预测。当前该库支持CogVideoX-Fun、Wan2.1、Wan2.1-Fun、Wan2.2，在examples文件夹下用文件夹名以区分，不同模型支持的功能不同，请视具体情况予以区分。以CogVideoX-Fun为例。
  - 文生视频：
    - 使用examples/cogvideox_fun/predict_t2v.py文件中修改prompt、neg_prompt、guidance_scale和seed。
    - 而后运行examples/cogvideox_fun/predict_t2v.py文件，等待生成结果，结果保存在samples/cogvideox-fun-videos文件夹中。
  - 图生视频：
    - 使用examples/cogvideox_fun/predict_i2v.py文件中修改validation_image_start、validation_image_end、prompt、neg_prompt、guidance_scale和seed。
    - validation_image_start是视频的开始图片，validation_image_end是视频的结尾图片。
    - 而后运行examples/cogvideox_fun/predict_i2v.py文件，等待生成结果，结果保存在samples/cogvideox-fun-videos_i2v文件夹中。
  - 视频生视频：
    - 使用examples/cogvideox_fun/predict_v2v.py文件中修改validation_video、validation_image_end、prompt、neg_prompt、guidance_scale和seed。
    - validation_video是视频生视频的参考视频。您可以使用以下视频运行演示：[演示视频](https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/cogvideox_fun/asset/v1/play_guitar.mp4)
    - 而后运行examples/cogvideox_fun/predict_v2v.py文件，等待生成结果，结果保存在samples/cogvideox-fun-videos_v2v文件夹中。
  - 普通控制生视频（Canny、Pose、Depth等）：
    - 使用examples/cogvideox_fun/predict_v2v_control.py文件中修改control_video、validation_image_end、prompt、neg_prompt、guidance_scale和seed。
    - control_video是控制生视频的控制视频，是使用Canny、Pose、Depth等算子提取后的视频。您可以使用以下视频运行演示：[演示视频](https://pai-aigc-photog.oss-cn-hangzhou.aliyuncs.com/cogvideox_fun/asset/v1.1/pose.mp4)
    - 而后运行examples/cogvideox_fun/predict_v2v_control.py文件，等待生成结果，结果保存在samples/cogvideox-fun-videos_v2v_control文件夹中。
- 步骤3：如果想结合自己训练的其他backbone与Lora，则看情况修改examples/{model_name}/predict_t2v.py中的examples/{model_name}/predict_i2v.py和lora_path。

#### d、通过ui界面

webui支持文生视频、图生视频、视频生视频和普通控制生视频（Canny、Pose、Depth等）。在examples文件夹下用文件夹名以区分，不同模型支持的功能不同，请视具体情况予以区分。以CogVideoX-Fun为例。

- 步骤1：下载对应[权重](#model-zoo)放入models文件夹。
- 步骤2：运行examples/cogvideox_fun/app.py文件，进入gradio页面。
- 步骤3：根据页面选择生成模型，填入prompt、neg_prompt、guidance_scale和seed等，点击生成，等待生成结果，结果保存在sample文件夹中。

# 参考文献
- CogVideo: https://github.com/THUDM/CogVideo/
- EasyAnimate: https://github.com/aigc-apps/EasyAnimate
- Wan2.1: https://github.com/Wan-Video/Wan2.1/
- Wan2.1: https://github.com/Wan-Video/Wan2.2/
- ComfyUI-KJNodes: https://github.com/kijai/ComfyUI-KJNodes
- ComfyUI-EasyAnimateWrapper: https://github.com/kijai/ComfyUI-EasyAnimateWrapper
- ComfyUI-CameraCtrl-Wrapper: https://github.com/chaojie/ComfyUI-CameraCtrl-Wrapper
- CameraCtrl: https://github.com/hehao13/CameraCtrl

# 许可证
本项目采用 [Apache License (Version 2.0)](https://github.com/modelscope/modelscope/blob/master/LICENSE).