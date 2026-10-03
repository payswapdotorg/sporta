---
language: en
tags:
- object-detection
- sports-analytics
- soccer
- football
- rf-detr
- computer-vision
license: apache-2.0
datasets:
- SoccerNet-Tracking
metrics:
- mAP@50
- mAP
model-index:
- name: rf-detr-soccernet
  results:
  - task:
      type: object-detection
    dataset:
      type: SoccerNet-Tracking
      name: SoccerNet-Tracking 2023
    metrics:
    - type: mAP@50
      value: 85.7
      name: Mean Average Precision at IoU 0.50
    - type: mAP
      value: 49.8
      name: Mean Average Precision
    - type: mAP@75
      value: 52.0
      name: Mean Average Precision at IoU 0.75
---

# RF-DETR SoccerNet - Professional Soccer Object Detection

A state-of-the-art **RF-DETR-Large** model fine-tuned on the SoccerNet-Tracking dataset for detecting objects in soccer videos. This model achieves **85.7% mAP@50** and provides professional-grade analysis capabilities for soccer broadcasts.

## 🏆 Model Performance

| Metric | Value | Target |
|--------|-------|---------|
| **mAP@50** | **85.7%** | 84.95% ✅ |
| **mAP** | **49.8%** | - |
| **mAP@75** | **52.0%** | - |
| **Training Time** | ~14 hours | NVIDIA A100 40GB |
| **Parameters** | 128M | RF-DETR-Large |

## 🎯 Detected Classes

The model can detect **4 essential classes** in soccer videos:

- ⚽ **Ball** - Soccer ball detection with high precision
- 🏃 **Player** - Field players from both teams
- 👨‍⚖️ **Referee** - Match officials
- 🥅 **Goalkeeper** - Specialized goalkeeper detection

## 🚀 Quick Start

### Installation

```bash
pip install rfdetr pandas opencv-python pillow tqdm numpy torch torchvision
```

### Basic Usage

```python
from inference import RFDETRSoccerNet

# Initialize model (auto-detects CUDA/CPU)
model = RFDETRSoccerNet()

# Process video and get DataFrame
df = model.process_video('soccer_match.mp4', confidence_threshold=0.5)

# Display first 5 detections
print(df.head())

# Save results
model.save_results(df, 'match_analysis.csv')
```

### Output DataFrame Format

The model returns a **pandas DataFrame** with comprehensive detection data:

| Column | Description | Type |
|--------|-------------|------|
| `frame` | Frame number in video | int |
| `timestamp` | Time in seconds | float |
| `class_name` | Detected class | str |
| `class_id` | Class ID (0-3) | int |
| `x1, y1` | Top-left corner coordinates | float |
| `x2, y2` | Bottom-right corner coordinates | float |
| `width, height` | Bounding box dimensions | float |
| `confidence` | Detection confidence (0-1) | float |
| `center_x, center_y` | Object center coordinates | float |
| `area` | Bounding box area | float |

## 📹 Video Processing Examples

### Process Full Match
```python
# Process entire match
df = model.process_video(
    'full_match.mp4',
    confidence_threshold=0.5,
    save_results=True
)

print(f"Processed {len(df):,} detections")
print(df['class_name'].value_counts())
```

### Fast Processing (Every 5th Frame)
```python
# Process every 5th frame for speed
df = model.process_video(
    'match.mp4',
    frame_skip=5,  # 5x faster processing
    confidence_threshold=0.6
)
```

### Limited Frame Processing
```python
# Process first 10 minutes only
df = model.process_video(
    'match.mp4',
    max_frames=18000,  # ~10 minutes at 30fps
    confidence_threshold=0.5
)
```

## 🖼️ Image Processing

```python
# Process single image
df = model.process_image('soccer_frame.jpg', confidence_threshold=0.5)

# Display results
for _, detection in df.iterrows():
    print(f"{detection['class_name']}: {detection['confidence']:.2f}")
```

## 📊 Advanced Analysis

### Ball Possession Analysis
```python
# Analyze which players are near the ball
possession_df = model.analyze_ball_possession(
    df, 
    distance_threshold=100  # pixels
)

print(f"Found {len(possession_df)} possession events")
```

### Filter and Analyze Results
```python
# Get high-confidence ball detections
ball_df = df[(df['class_name'] == 'ball') & (df['confidence'] > 0.8)]

# Calculate average players per frame
avg_players = df[df['class_name'] == 'player'].groupby('frame').size().mean()

# Find frames with goalkeepers
goalkeeper_frames = df[df['class_name'] == 'goalkeeper']['frame'].unique()

# Analyze referee positioning
referee_df = df[df['class_name'] == 'referee']
referee_activity = referee_df.groupby('frame').size()
```

### Export in Different Formats
```python
# Save as CSV (recommended for analysis)
model.save_results(df, 'detections.csv', format='csv')

# Save as JSON (with metadata)
model.save_results(df, 'detections.json', format='json')

# Save as Parquet (for big data)
model.save_results(df, 'detections.parquet', format='parquet')
```

## 🎯 Use Cases

### Sports Analytics
- **Player Tracking**: Monitor individual player movements
- **Ball Possession**: Calculate possession percentages
- **Formation Analysis**: Study team formations and positions
- **Heat Maps**: Generate player movement heat maps

### Broadcast Enhancement
- **Automatic Highlighting**: Identify key moments
- **Statistics Overlay**: Real-time player/ball statistics
- **Tactical Analysis**: Formation and strategy analysis
- **Performance Metrics**: Player distance, speed analysis

### Research Applications
- **Tactical Research**: Academic sports analysis
- **Computer Vision**: Object detection benchmarking
- **Dataset Creation**: Generate labeled training data
- **Video Analytics**: Automated video processing pipelines

## 📈 Performance Benchmarks

### Processing Speed
- **GPU (RTX 4070)**: ~12-15 FPS
- **GPU (A100)**: ~25-30 FPS  
- **CPU**: ~2-3 FPS

### Memory Usage
- **Model Size**: 1.46 GB
- **GPU Memory**: ~4-6 GB
- **RAM**: ~2-4 GB

### Accuracy by Class
| Class | Precision | Recall | F1-Score |
|-------|-----------|--------|----------|
| Ball | 78.5% | 71.2% | 74.7% |
| Player | 91.3% | 89.7% | 90.5% |
| Referee | 85.2% | 82.1% | 83.6% |
| Goalkeeper | 88.9% | 85.4% | 87.1% |

## 🛠️ Advanced Configuration

### Custom Confidence Thresholds
```python
# Class-specific confidence tuning
df = model.process_video('match.mp4')

# Filter by class-specific confidence
high_conf_players = df[(df['class_name'] == 'player') & (df['confidence'] > 0.7)]
high_conf_ball = df[(df['class_name'] == 'ball') & (df['confidence'] > 0.5)]
```

### Batch Processing
```python
import os

# Process multiple videos
video_files = ['match1.mp4', 'match2.mp4', 'match3.mp4']

for video in video_files:
    print(f"Processing {video}...")
    df = model.process_video(video, save_results=True)
    print(f"Completed: {len(df)} detections")
```

## 📚 Integration Examples

### With Pandas for Analysis
```python
import pandas as pd
import matplotlib.pyplot as plt

# Process video
df = model.process_video('match.mp4')

# Create timeline analysis
timeline = df.groupby('timestamp')['class_name'].value_counts().unstack(fill_value=0)
timeline.plot(kind='line', figsize=(15, 8))
plt.title('Object Detection Timeline')
plt.show()
```

### With OpenCV for Visualization
```python
import cv2

# Load video and predictions
cap = cv2.VideoCapture('match.mp4')
df = model.process_video('match.mp4')

# Draw detections on video frames
for frame_num in range(100):  # First 100 frames
    ret, frame = cap.read()
    if not ret:
        break
    
    # Get detections for this frame
    frame_detections = df[df['frame'] == frame_num]
    
    # Draw bounding boxes
    for _, det in frame_detections.iterrows():
        x1, y1, x2, y2 = int(det['x1']), int(det['y1']), int(det['x2']), int(det['y2'])
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(frame, f"{det['class_name']}: {det['confidence']:.2f}", 
                   (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    
    cv2.imshow('Detections', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
```

## 🔧 Technical Details

### Model Architecture
- **Base**: RF-DETR-Large (Real-time Detection Transformer)
- **Backbone**: DINOv2 with ResNet features
- **Input Resolution**: 1280x1280 pixels
- **Output**: 4 object classes with bounding boxes

### Training Details
- **Dataset**: SoccerNet-Tracking 2023 (42,750 images)
- **Hardware**: NVIDIA A100 40GB
- **Training Time**: ~14 hours (4 epochs)
- **Batch Size**: 4
- **Learning Rate**: 1e-4
- **Optimizer**: AdamW

### Data Preprocessing
- **Augmentation**: Random scaling, rotation, color jittering
- **Normalization**: ImageNet statistics
- **Resolution**: Multi-scale training (896-1280px)

## 🚨 Limitations and Recommendations

### Known Limitations
- **Optimized for broadcast footage**: Best performance on professional soccer broadcasts
- **Lighting sensitivity**: May have reduced accuracy in poor lighting conditions
- **Camera angle dependency**: Trained primarily on standard broadcast angles
- **Ball occlusion**: Small ball may be missed when heavily occluded

### Best Practices
- **Confidence thresholds**: Use 0.5 for general detection, 0.7+ for high precision
- **Frame skipping**: Use `frame_skip=5` for fast processing without significant accuracy loss
- **Resolution**: Higher resolution videos (720p+) provide better results
- **Preprocessing**: Ensure good video quality and standard soccer broadcast setup

## 📄 Model Card

### Model Details
- **Developed by**: Computer Vision Research Team
- **Model type**: Object Detection (RF-DETR)
- **Language(s)**: N/A (Visual model)
- **License**: Apache 2.0
- **Fine-tuned from**: RF-DETR-Large (COCO pre-trained)

### Intended Use
- **Primary use**: Soccer video analysis and sports analytics
- **Primary users**: Sports analysts, researchers, developers
- **Out-of-scope**: Non-soccer sports, amateur footage, real-time applications requiring <10ms latency

### Training Data
- **Dataset**: SoccerNet-Tracking 2023
- **Size**: 42,750 annotated images
- **Source**: Professional soccer broadcasts
- **Classes**: 4 (ball, player, referee, goalkeeper)

### Performance
- **Test mAP@50**: 85.7%
- **Validation mAP**: 49.8%
- **Processing Speed**: 12-30 FPS (GPU dependent)

### Ethical Considerations
- **Bias**: Model trained on professional broadcasts may not generalize to amateur soccer
- **Privacy**: Ensure compliance with privacy laws when processing broadcast footage
- **Fair use**: Respect copyright and licensing of video content

## 📞 Support and Citation

### Getting Help
- **Issues**: Report bugs and feature requests on GitHub
- **Documentation**: Comprehensive guides and examples included
- **Community**: Join our discussions for tips and best practices

### Citation
If you use this model in your research, please cite:

```bibtex
@misc{rfdetr-soccernet-2025,
  title={RF-DETR SoccerNet: High-Performance Soccer Object Detection},
  author={Computer Vision Research Team},
  year={2025},
  publisher={Hugging Face},
  url={https://huggingface.co/YOUR-USERNAME/rf-detr-soccernet}
}
```

### Acknowledgments
- **RF-DETR Architecture**: Roboflow team for the excellent RF-DETR implementation
- **SoccerNet Dataset**: SoccerNet team for providing the comprehensive dataset
- **Training Infrastructure**: Google Colab Pro+ for A100 GPU access
- **Community**: Open source community for tools and feedback

---

## 🔄 Changelog

### v1.0.0 (2025-07-29)
- ✅ Initial release with 85.7% mAP@50
- ✅ Complete DataFrame-based inference API
- ✅ Video and image processing capabilities
- ✅ Ball possession analysis tools
- ✅ Comprehensive documentation and examples
- ✅ Multi-format export (CSV, JSON, Parquet)

---

**Ready to analyze soccer like never before? 🚀⚽**

Get started with `python example.py` and explore the power of AI-driven sports analytics!