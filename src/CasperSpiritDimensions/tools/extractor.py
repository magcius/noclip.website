import os

extract_path = "../../../data/CasperSD"
raw_path = "../../../data/CasperSD_raw"
toc_path = f"{raw_path}/DATA.TOC"
hff_path = f"{raw_path}/DATA.HFF"

if not os.path.exists(toc_path) or not os.path.exists(hff_path):
    raise Exception("Missing DATA.TOC or DATA.HFF")

extracted_count = 0
total_count = 0

with open(toc_path, 'rb') as toc_file, open(hff_path, 'rb') as hff_file:

    header = toc_file.readline().strip().decode('ascii')
    if not header:
        raise Exception("Could not read header")

    try:
        total_count = int(header)
        print(f"Total file count: {total_count}")
    except ValueError:
        raise Exception("Could not parse file count")

    for i in range(total_count):
        line_bytes = toc_file.readline().strip()
        if not line_bytes:
            break

        line = line_bytes.decode('ascii')
        parts = line.split('|')
        
        if len(parts) < 4:
            continue

        file_name = parts[0]
        sub_dir = parts[1].strip('/').replace('/', os.sep)
        file_size = int(parts[2])
        offset = int(parts[3])

        if file_size == 0:
            continue

        output_dir = os.path.join(extract_path, sub_dir)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        output_path = os.path.join(output_dir, file_name)

        hff_file.seek(offset)
        file_data = hff_file.read(file_size)

        if len(file_data) != file_size:
            print(f"Warning: Size mismatch for {file_name}. Expected {file_size}, got {len(file_data)}.")

        with open(output_path, 'wb') as out_file:
            out_file.write(file_data)

        extracted_count += 1

print(f"Finished! Successfully extracted {extracted_count} files, skipped {total_count - extracted_count} empty files")
