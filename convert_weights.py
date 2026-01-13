import pickle
import json
import sys
import os

def convert(pickle_path, output_dir):
    with open(pickle_path, 'rb') as f:
        # NLTK uses a specific structure for AveragedPerceptron
        # It's usually a tuple (weights, classes, tagdict)
        data = pickle.load(f)
    
    if isinstance(data, tuple) and len(data) == 3:
        # NLTK: (weights, tagdict, classes)
        weights, tagdict, classes = data
    else:
        # Some versions might be different, let's check
        print(f"Unexpected data type: {type(data)}")
        if hasattr(data, 'weights'):
            weights = data.weights
            classes = data.classes
            tagdict = data.tagdict
        else:
            print("Could not find weights/classes/tagdict")
            return

    class SetEncoder(json.JSONEncoder):
        def default(self, obj):
            if isinstance(obj, set):
                return list(obj)
            return json.JSONEncoder.default(self, obj)

    os.makedirs(output_dir, exist_ok=True)
    
    with open(os.path.join(output_dir, 'weights.json'), 'w') as f:
        json.dump(weights, f, cls=SetEncoder)
    
    with open(os.path.join(output_dir, 'classes.txt'), 'w') as f:
        f.write('\n'.join(sorted(list(classes))))
    
    with open(os.path.join(output_dir, 'tags.json'), 'w') as f:
        json.dump(tagdict, f)
    
    print(f"Successfully exported weights.json, classes.txt, and tags.json to {output_dir}")

if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
